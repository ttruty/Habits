import { afterEach, describe, expect, it, vi } from 'vitest';
import { oauthApp, oauthProviders } from './registry.ts';
import { stravaProvider } from './strava.ts';
import { withingsProvider } from './withings.ts';

/** A fetch answering each call with the next reply, recording URL, headers and form body. */
function fake(...replies: { status?: number; body?: unknown }[]) {
  const calls: { url: string; headers: Record<string, string>; form: Record<string, string> }[] =
    [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      form: Object.fromEntries(new URLSearchParams((init?.body as string) ?? '')),
    });
    const r = replies.shift() ?? {};
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const app = (f: typeof fetch) => ({ clientId: 'cid', clientSecret: 'shh', fetch: f });
const ok = (body: unknown) => ({ body: { status: 0, body } });

afterEach(() => vi.unstubAllGlobals());

describe('registry', () => {
  it('knows Strava and Withings, with credentials from <KIND>_CLIENT_*', () => {
    expect(Object.keys(oauthProviders)).toEqual(['strava', 'withings']);
    vi.stubGlobal('Deno', {
      env: { get: (k: string) => ({ WITHINGS_CLIENT_ID: 'w1', WITHINGS_CLIENT_SECRET: 'w2' })[k] },
    });
    expect(oauthApp('withings', fetch)).toEqual({ clientId: 'w1', clientSecret: 'w2', fetch });
    expect(oauthApp('strava', fetch).clientId).toBe('');
  });
});

describe('Withings', () => {
  it('builds the authorize URL for user.activity', () => {
    const url = new URL(withingsProvider.authorizeUrl(app(fetch), 'https://x/cb', 'st'));
    expect(url.origin + url.pathname).toBe('https://account.withings.com/oauth2_user/authorize2');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      scope: 'user.activity',
      redirect_uri: 'https://x/cb',
      state: 'st',
    });
  });

  it('exchanges a code (no signature needed) and checks the granted scope', async () => {
    const f = fake(
      ok({
        userid: 12345,
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 10800,
        scope: 'user.info,user.activity',
      }),
    );
    const t = await withingsProvider.exchangeCode(app(f.fetch), 'code1', 'https://x/cb');
    expect(f.calls[0].url).toBe('https://wbsapi.withings.net/v2/oauth2');
    expect(f.calls[0].form).toEqual({
      action: 'requesttoken',
      client_id: 'cid',
      client_secret: 'shh',
      grant_type: 'authorization_code',
      code: 'code1',
      redirect_uri: 'https://x/cb',
    });
    expect(t).toMatchObject({ accessToken: 'a', refreshToken: 'r', userId: '12345' });
    expect(t.expiresAt.getTime() - Date.now()).toBeGreaterThan(10_000_000);
    expect(withingsProvider.scopeGranted(new URLSearchParams(), t)).toBe(true);
    // Before the exchange there are no tokens yet: don't refuse (the bug that blocked every connect).
    expect(withingsProvider.scopeGranted(new URLSearchParams('code=c&state=s'))).toBe(true);
    expect(withingsProvider.scopeGranted(new URLSearchParams(), { ...t, scope: 'user.info' })).toBe(
      false,
    );
  });

  it('refreshes, getting a new refresh token', async () => {
    const f = fake(ok({ userid: '1', access_token: 'a2', refresh_token: 'r2', expires_in: 10800 }));
    const t = await withingsProvider.refresh(app(f.fetch), 'r1');
    expect(f.calls[0].form).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' });
    expect(t.refreshToken).toBe('r2');
  });

  it('fetches steps and workouts for a range, paging, with the bearer token', async () => {
    const f = fake(
      ok({ activities: [{ date: '2026-10-01', steps: 9000 }], more: true, offset: 1 }),
      ok({ activities: [{ date: '2026-10-02', steps: 100 }], more: false }),
      ok({
        series: [
          { id: 1, category: 6, startdate: 1, enddate: 1801, date: '2026-10-01' },
          { id: 2, category: 1, startdate: 1, enddate: 61, date: '2026-09-29' },
        ],
        more: false,
      }),
    );
    const events = await withingsProvider.fetchRange(
      app(f.fetch),
      'tok',
      '2026-10-01',
      '2026-10-02',
    );
    expect(events.map((e) => [e.externalId, e.value])).toEqual([
      ['steps:2026-10-01', 9000],
      ['steps:2026-10-02', 100],
      ['workout:1', 1800],
    ]);
    const [first, second, workouts] = f.calls;
    expect(first.headers.Authorization).toBe('Bearer tok');
    expect(first.form).toMatchObject({
      action: 'getactivity',
      startdateymd: '2026-10-01',
      enddateymd: '2026-10-02',
    });
    expect(second.form.offset).toBe('1');
    expect(workouts.form).toMatchObject({
      action: 'getworkouts',
      data_fields: 'steps,distance,pause_duration',
    });
  });

  it('subscribes to activity notifications and unsubscribes best-effort', async () => {
    const f = fake(ok({}), { body: { status: 503 } });
    await withingsProvider.subscribe(app(f.fetch), 'tok', 'https://x/hook');
    expect(f.calls[0].form).toEqual({
      action: 'subscribe',
      callbackurl: 'https://x/hook',
      appli: '16',
    });
    await expect(
      withingsProvider.release(app(f.fetch), 'tok', 'https://x/hook'),
    ).resolves.toBeUndefined();
    expect(f.calls[1].form.action).toBe('revoke');
  });

  it('reports Withings errors and rate limits', async () => {
    await expect(
      withingsProvider.refresh(app(fake({ body: { status: 503 } }).fetch), 'r'),
    ).rejects.toThrow('status 503');
    await expect(
      withingsProvider.refresh(app(fake({ body: { status: 601 } }).fetch), 'r'),
    ).rejects.toThrow('rate limit');
    await expect(withingsProvider.refresh(app(fake({ status: 429 }).fetch), 'r')).rejects.toThrow(
      'rate limit',
    );
  });

  it('answers the HEAD check and turns notifications into hints', async () => {
    const head = await withingsProvider.webhook(new Request('https://x/hook', { method: 'HEAD' }));
    expect(head.response.status).toBe(200);
    expect(head.hints).toEqual([]);
    const post = await withingsProvider.webhook(
      new Request('https://x/hook', {
        method: 'POST',
        body: new URLSearchParams({
          userid: '5',
          appli: '16',
          startdate: '1759312800',
          enddate: '1759316400',
        }),
      }),
    );
    expect(post.hints).toEqual([
      { kind: 'range', userId: '5', from: '2025-09-30', to: '2025-10-02' },
    ]);
  });
});

describe('Strava', () => {
  it('fetches a range of local days, starting the UTC query a day early', async () => {
    const f = fake({
      body: [
        {
          id: 1,
          sport_type: 'Run',
          start_date: '2026-10-01T12:00:00Z',
          start_date_local: '2026-10-01T08:00:00Z',
          moving_time: 600,
        },
        {
          id: 2,
          sport_type: 'Run',
          start_date: '2026-09-30T12:00:00Z',
          start_date_local: '2026-09-30T08:00:00Z',
          moving_time: 600,
        },
      ],
    });
    const events = await stravaProvider.fetchRange(app(f.fetch), 'tok', '2026-10-01', '2026-10-01');
    expect(events.map((e) => e.externalId)).toEqual(['1']);
    expect(new URL(f.calls[0].url).searchParams.get('after')).toBe(
      String(Date.parse('2026-09-30T00:00:00Z') / 1000),
    );
  });

  it('fetches one activity, or null when it is gone', async () => {
    const f = fake(
      {
        body: {
          id: 5,
          sport_type: 'Ride',
          start_date: '2026-10-01T12:00:00Z',
          start_date_local: '2026-10-01T08:00:00Z',
          moving_time: 60,
        },
      },
      { status: 404 },
    );
    expect((await stravaProvider.fetchItem!(app(f.fetch), 'tok', '5'))?.externalId).toBe('5');
    expect(await stravaProvider.fetchItem!(app(f.fetch), 'tok', '6')).toBeNull();
  });

  it('maps tokens and the athlete', async () => {
    const tokens = {
      access_token: 'a',
      refresh_token: 'r',
      expires_at: 2_000_000_000,
      athlete: { id: 7, firstname: 'Tim' },
    };
    const t = await stravaProvider.exchangeCode(
      app(fake({ body: tokens }).fetch),
      'c',
      'https://x/cb',
    );
    expect(t).toMatchObject({ userId: '7', displayName: 'Tim', accessToken: 'a' });
    expect(t.expiresAt.toISOString()).toBe('2033-05-18T03:33:20.000Z');
    expect(stravaProvider.scopeGranted(new URLSearchParams('scope=read,activity:read_all'))).toBe(
      true,
    );
    const r = await stravaProvider.refresh(
      app(fake({ body: { ...tokens, athlete: undefined } }).fetch),
      'r',
    );
    expect(r.userId).toBe('');
  });

  it('answers the subscription check with STRAVA_VERIFY_TOKEN and turns POSTs into hints', async () => {
    vi.stubGlobal('Deno', { env: { get: () => 'v' } });
    const check = await stravaProvider.webhook(
      new Request('https://x/hook?hub.mode=subscribe&hub.verify_token=v&hub.challenge=abc'),
    );
    expect(await check.response.json()).toEqual({ 'hub.challenge': 'abc' });
    const bad = await stravaProvider.webhook(
      new Request('https://x/hook?hub.mode=subscribe&hub.verify_token=no'),
    );
    expect(bad.response.status).toBe(403);
    const post = await stravaProvider.webhook(
      new Request('https://x/hook', {
        method: 'POST',
        body: JSON.stringify({ object_type: 'activity', object_id: 9, owner_id: 7 }),
      }),
    );
    expect(post.hints).toEqual([{ kind: 'item', userId: '7', itemId: '9' }]);
    const junk = await stravaProvider.webhook(
      new Request('https://x/hook', { method: 'POST', body: 'nope' }),
    );
    expect(junk.hints).toEqual([]);
  });

  it('subscribes once per app and deauthorizes on release', async () => {
    vi.stubGlobal('Deno', { env: { get: () => 'v' } });
    const f = fake({ body: [{ id: 1, callback_url: 'https://x/hook' }] }, {});
    await stravaProvider.subscribe(app(f.fetch), 'tok', 'https://x/hook');
    await stravaProvider.release(app(f.fetch), 'tok', 'https://x/hook');
    expect(f.calls[1].url).toBe('https://www.strava.com/oauth/deauthorize');
  });
});
