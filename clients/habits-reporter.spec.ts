import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReporter,
  localDateKey,
  localStorageQueue,
  type HabitsEvent,
  type QueueStore,
  type Reporter,
  type ReporterStatus,
} from './habits-reporter';

const cfg = { url: 'https://x.supabase.co/functions/v1/ingest', token: 'hab_test' };

const event = (externalId: string, value = 1): HabitsEvent => ({
  externalId,
  type: 'workout.completed',
  occurredAt: '2026-10-01T12:00:00.000Z',
  localDate: '2026-10-01',
  value,
});

function memory(initial: HabitsEvent[] = []): QueueStore & { saved: HabitsEvent[] } {
  const s = {
    saved: initial,
    load: async () => [...s.saved],
    save: async (events: HabitsEvent[]) => {
      s.saved = [...events];
    },
  };
  return s;
}

/** A fetch that answers with the queued statuses (or throws for 'offline'), recording bodies. */
function server(...replies: (number | 'offline')[]) {
  const bodies: { events: HabitsEvent[] }[] = [];
  const headers: Record<string, string>[] = [];
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string));
    headers.push(init.headers as Record<string, string>);
    const reply = replies.shift() ?? 200;
    if (reply === 'offline') throw new TypeError('Failed to fetch');
    return new Response('{}', { status: reply });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, bodies, headers, calls: fetch };
}

let reporter: Reporter | undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  reporter?.stop();
  reporter = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('createReporter', () => {
  it('queues nothing and sends nothing while off', async () => {
    const store = memory();
    const s = server();
    const statuses: ReporterStatus[] = [];
    reporter = createReporter({
      config: () => null,
      store,
      fetch: s.fetch,
      onStatus: (x) => statuses.push(x),
    });
    await reporter.report(event('a'));
    await tick(60_000);
    expect(store.saved).toEqual([]);
    expect(s.calls).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.state).toBe('off');
  });

  it('treats a half-filled config as off', async () => {
    const store = memory();
    reporter = createReporter({
      config: () => ({ url: cfg.url, token: '' }),
      store,
      fetch: server().fetch,
    });
    await reporter.report(event('a'));
    expect(store.saved).toEqual([]);
  });

  it('sends a burst of reports as one batch, with the token, then empties the queue', async () => {
    const store = memory();
    const s = server(200);
    reporter = createReporter({ config: () => cfg, store, fetch: s.fetch });
    await reporter.report(event('a'));
    await reporter.report(event('b'));
    expect(store.saved.map((e) => e.externalId)).toEqual(['a', 'b']);
    await tick(2_000);
    expect(s.bodies).toEqual([{ events: [event('a'), event('b')] }]);
    expect(s.headers[0].Authorization).toBe('Bearer hab_test');
    expect(store.saved).toEqual([]);
  });

  it('replaces a queued event with the same externalId', async () => {
    const store = memory();
    reporter = createReporter({ config: () => cfg, store, fetch: server().fetch });
    await reporter.report(event('day', 600));
    await reporter.report(event('day', 900));
    expect(store.saved).toEqual([event('day', 900)]);
  });

  it('sends in batches of 100', async () => {
    const queued = Array.from({ length: 150 }, (_, i) => event(`e${i}`));
    const s = server(200, 200);
    reporter = createReporter({ config: () => cfg, store: memory(queued), fetch: s.fetch });
    await reporter.flush();
    expect(s.bodies.map((b) => b.events.length)).toEqual([100, 50]);
  });

  it('sends what was left from last time on start', async () => {
    const store = memory([event('old')]);
    const s = server(200);
    reporter = createReporter({ config: () => cfg, store, fetch: s.fetch });
    await tick(2_000);
    expect(s.bodies[0].events).toEqual([event('old')]);
  });

  it('keeps events while offline and retries with growing backoff', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1); // no jitter
    const store = memory();
    const s = server('offline', 503, 200);
    const statuses: string[] = [];
    reporter = createReporter({
      config: () => cfg,
      store,
      fetch: s.fetch,
      onStatus: (x) => statuses.push(x.state),
    });
    await reporter.report(event('a'));
    await tick(2_000); // first try: offline
    expect(store.saved).toHaveLength(1);
    await tick(4_999);
    expect(s.calls).toHaveBeenCalledTimes(1);
    await tick(1); // 5 s later: 503
    expect(s.calls).toHaveBeenCalledTimes(2);
    await tick(10_000); // then 10 s: sent
    expect(s.calls).toHaveBeenCalledTimes(3);
    expect(store.saved).toEqual([]);
    expect(statuses).toContain('retrying');
    expect(statuses.at(-1)).toBe('idle');
  });

  it('caps the backoff', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const s = server(...Array(20).fill(500));
    reporter = createReporter({
      config: () => cfg,
      store: memory([event('a')]),
      fetch: s.fetch,
      retryMinMs: 1_000,
      retryMaxMs: 8_000,
    });
    await reporter.flush();
    await tick(1_000 + 2_000 + 4_000 + 8_000);
    expect(s.calls).toHaveBeenCalledTimes(5);
    await tick(8_000);
    expect(s.calls).toHaveBeenCalledTimes(6);
  });

  it('waits for the browser to come back online', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const s = server(200);
    const store = memory([event('a')]);
    reporter = createReporter({ config: () => cfg, store, fetch: s.fetch });
    await reporter.flush();
    expect(s.calls).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true });
    window.dispatchEvent(new Event('online'));
    await tick(0);
    expect(s.calls).toHaveBeenCalledTimes(1);
    expect(store.saved).toEqual([]);
  });

  it('sends when the page is hidden', async () => {
    const s = server(200);
    reporter = createReporter({
      config: () => cfg,
      store: memory(),
      fetch: s.fetch,
      sendDelayMs: 60_000,
    });
    await reporter.report(event('a'));
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    expect(s.calls).toHaveBeenCalledTimes(1);
  });

  it('keeps events and says so when the token is refused', async () => {
    const statuses: string[] = [];
    const store = memory([event('a')]);
    reporter = createReporter({
      config: () => cfg,
      store,
      fetch: server(401).fetch,
      onStatus: (x) => statuses.push(x.state),
    });
    await reporter.flush();
    expect(store.saved).toHaveLength(1);
    expect(statuses.at(-1)).toBe('token');
  });

  it('drops a batch the server refuses for good, so it cannot block the queue', async () => {
    const store = memory([event('a')]);
    reporter = createReporter({ config: () => cfg, store, fetch: server(400).fetch });
    await reporter.flush();
    expect(store.saved).toEqual([]);
  });

  it('keeps a replacement queued while its older copy was being sent', async () => {
    const store = memory([event('day', 600)]);
    let release!: () => void;
    // The first send hangs until released; the next one (the replacement) gets a 503.
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (release = () => resolve(new Response('{}')))),
      )
      .mockImplementation(
        async () => new Response('{}', { status: 503 }),
      ) as unknown as typeof globalThis.fetch;
    reporter = createReporter({ config: () => cfg, store, fetch });
    const sending = reporter.flush();
    await tick(0);
    await reporter.report(event('day', 900));
    release();
    await sending;
    expect(store.saved).toEqual([event('day', 900)]);
  });

  it('runs one send at a time', async () => {
    const s = server(200);
    reporter = createReporter({ config: () => cfg, store: memory([event('a')]), fetch: s.fetch });
    await Promise.all([reporter.flush(), reporter.flush()]);
    expect(s.calls).toHaveBeenCalledTimes(1);
  });

  it('drops the oldest events past the queue limit', async () => {
    const store = memory();
    reporter = createReporter({ config: () => cfg, store, fetch: server().fetch, maxQueue: 2 });
    for (const id of ['a', 'b', 'c']) await reporter.report(event(id));
    expect(store.saved.map((e) => e.externalId)).toEqual(['b', 'c']);
  });

  it('never throws into the host app', async () => {
    const broken: QueueStore = {
      load: async () => Promise.reject(new Error('blocked')),
      save: async () => Promise.reject(new Error('full')),
    };
    reporter = createReporter({
      config: () => Promise.reject(new Error('settings unreadable')),
      store: broken,
      onStatus: () => {
        throw new Error('listener bug');
      },
    });
    await expect(reporter.report(event('a'))).resolves.toBeUndefined();
    await expect(reporter.flush()).resolves.toBeUndefined();

    const r2 = createReporter({ config: () => cfg, store: broken, fetch: server(200).fetch });
    await expect(r2.report(event('a'))).resolves.toBeUndefined();
    await expect(r2.flush()).resolves.toBeUndefined();
    r2.stop();
  });

  it('stops sending after stop()', async () => {
    const s = server(200);
    reporter = createReporter({ config: () => cfg, store: memory(), fetch: s.fetch });
    await reporter.report(event('a'));
    reporter.stop();
    await tick(60_000);
    window.dispatchEvent(new Event('online'));
    await tick(0);
    expect(s.calls).not.toHaveBeenCalled();
  });
});

describe('localStorageQueue', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips and survives bad data', async () => {
    const q = localStorageQueue('k');
    expect(await q.load()).toEqual([]);
    await q.save([event('a')]);
    expect(await q.load()).toEqual([event('a')]);
    localStorage.setItem('k', '{oops');
    expect(await q.load()).toEqual([]);
    localStorage.setItem('k', '{"not":"a list"}');
    expect(await q.load()).toEqual([]);
  });

  it('ignores a full store', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await expect(localStorageQueue().save([event('a')])).resolves.toBeUndefined();
  });
});

it('formats local dates', () => {
  expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
});
