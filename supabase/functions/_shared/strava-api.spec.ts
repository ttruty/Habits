import { describe, expect, it, vi } from 'vitest';
import {
  RateLimited,
  StravaError,
  authorizeUrl,
  deauthorize,
  ensureSubscription,
  exchangeCode,
  getActivity,
  listActivities,
  refreshTokens,
} from './strava-api.ts';

/** A fetch that answers each call with the next queued reply, recording what was asked. */
function fake(...replies: { status?: number; body?: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift() ?? {};
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const app = (f: typeof fetch) => ({ clientId: '123', clientSecret: 'shh', fetch: f });

describe('OAuth', () => {
  it('builds the authorize URL', () => {
    const url = new URL(authorizeUrl(app(fetch), 'https://x/cb', 'st', 'activity:read_all'));
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '123',
      redirect_uri: 'https://x/cb',
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'activity:read_all',
      state: 'st',
    });
  });

  it('exchanges a code and refreshes tokens with a form POST', async () => {
    const tokens = { access_token: 'a', refresh_token: 'r', expires_at: 1, athlete: { id: 7 } };
    const f = fake({ body: tokens }, { body: tokens });
    expect(await exchangeCode(app(f.fetch), 'code1')).toEqual(tokens);
    await refreshTokens(app(f.fetch), 'r0');
    const bodies = f.calls.map((c) =>
      Object.fromEntries(new URLSearchParams(c.init!.body as string)),
    );
    expect(bodies[0]).toMatchObject({
      code: 'code1',
      grant_type: 'authorization_code',
      client_secret: 'shh',
    });
    expect(bodies[1]).toMatchObject({ refresh_token: 'r0', grant_type: 'refresh_token' });
  });

  it('throws on errors and rate limits', async () => {
    await expect(exchangeCode(app(fake({ status: 400 }).fetch), 'x')).rejects.toBeInstanceOf(
      StravaError,
    );
    await expect(exchangeCode(app(fake({ status: 429 }).fetch), 'x')).rejects.toBeInstanceOf(
      RateLimited,
    );
  });

  it('deauthorizes best-effort', async () => {
    const f = fake({ status: 401 });
    await expect(deauthorize(f.fetch, 'tok')).resolves.toBeUndefined();
    const g = vi.fn(async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    await expect(deauthorize(g, 'tok')).resolves.toBeUndefined();
  });
});

describe('activities', () => {
  it('pages through activities until a short page', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
    const f = fake({ body: page(200) }, { body: page(3) });
    const list = await listActivities(f.fetch, 'tok', 1000);
    expect(list).toHaveLength(203);
    expect(f.calls.map((c) => new URL(c.url).searchParams.get('page'))).toEqual(['1', '2']);
    expect(f.calls[0].url).toContain('after=1000');
    expect((f.calls[0].init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('gets one activity, or null when Strava no longer returns it', async () => {
    const f = fake({ body: { id: 5 } }, { status: 404 }, { status: 403 });
    expect(await getActivity(f.fetch, 'tok', 5)).toEqual({ id: 5 });
    expect(await getActivity(f.fetch, 'tok', 6)).toBeNull();
    expect(await getActivity(f.fetch, 'tok', 7)).toBeNull();
    await expect(getActivity(fake({ status: 500 }).fetch, 'tok', 8)).rejects.toBeInstanceOf(
      StravaError,
    );
  });
});

describe('ensureSubscription', () => {
  it('keeps a matching subscription', async () => {
    const f = fake({ body: [{ id: 1, callback_url: 'https://x/hook' }] });
    expect(await ensureSubscription(app(f.fetch), 'https://x/hook', 'v')).toBe('exists');
    expect(f.calls).toHaveLength(1);
  });

  it('replaces one that points elsewhere', async () => {
    const f = fake(
      { body: [{ id: 1, callback_url: 'https://old/hook' }] },
      { status: 200 },
      { body: { id: 2 } },
    );
    expect(await ensureSubscription(app(f.fetch), 'https://x/hook', 'v')).toBe('created');
    expect(f.calls[1].init?.method).toBe('DELETE');
    const created = Object.fromEntries(new URLSearchParams(f.calls[2].init!.body as string));
    expect(created).toMatchObject({ callback_url: 'https://x/hook', verify_token: 'v' });
  });
});
