// Withings HTTP API (https://developer.withings.com). Every call is a form POST answering
// { status, body }; status 0 is success. `fetch` comes from the caller, for tests.

import type { WithingsActivity, WithingsWorkout } from './connectors/withings.ts';
import { RateLimited } from './strava-api.ts';

const API = 'https://wbsapi.withings.net';
export const WITHINGS_AUTHORIZE = 'https://account.withings.com/oauth2_user/authorize2';

export class WithingsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface WithingsTokenBody {
  userid: string | number;
  access_token: string;
  refresh_token: string;
  /** Seconds. */
  expires_in: number;
  scope?: string;
}

async function call<T>(
  f: typeof fetch,
  path: string,
  fields: Record<string, string>,
  token?: string,
): Promise<T> {
  const res = await f(`${API}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  });
  if (res.status === 429) throw new RateLimited();
  const json = (await res.json().catch(() => ({ status: -1 }))) as { status: number; body?: T };
  if (json.status === 601) throw new RateLimited();
  if (json.status !== 0) {
    throw new WithingsError(json.status, `Withings ${fields.action} failed: status ${json.status}`);
  }
  return json.body as T;
}

export function requestToken(
  f: typeof fetch,
  fields: { client_id: string; client_secret: string } & Record<string, string>,
) {
  return call<WithingsTokenBody>(f, 'v2/oauth2', { action: 'requesttoken', ...fields });
}

/** Pages through a Measure v2 list (more = 1 → call again with offset). */
async function paged<T>(
  f: typeof fetch,
  token: string,
  fields: Record<string, string>,
  key: 'activities' | 'series',
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (let i = 0; i < 50; i++) {
    const body = await call<Record<string, unknown>>(
      f,
      'v2/measure',
      { ...fields, ...(offset ? { offset: String(offset) } : {}) },
      token,
    );
    out.push(...((body[key] as T[] | undefined) ?? []));
    if (!body.more) break;
    offset = Number(body.offset) || 0;
  }
  return out;
}

export function getActivity(f: typeof fetch, token: string, from: string, to: string) {
  return paged<WithingsActivity>(
    f,
    token,
    { action: 'getactivity', startdateymd: from, enddateymd: to, data_fields: 'steps' },
    'activities',
  );
}

export function getWorkouts(f: typeof fetch, token: string, from: string, to: string) {
  return paged<WithingsWorkout>(
    f,
    token,
    {
      action: 'getworkouts',
      startdateymd: from,
      enddateymd: to,
      data_fields: 'steps,distance,pause_duration',
    },
    'series',
  );
}

/** Subscribe `callbackUrl` to a notification category for this user. */
export async function subscribe(
  f: typeof fetch,
  token: string,
  callbackUrl: string,
  appli: number,
) {
  await call(
    f,
    'notify',
    { action: 'subscribe', callbackurl: callbackUrl, appli: String(appli) },
    token,
  );
}

/** Best effort: stop notifications for this user. */
export async function unsubscribe(
  f: typeof fetch,
  token: string,
  callbackUrl: string,
  appli: number,
) {
  await call(
    f,
    'notify',
    { action: 'revoke', callbackurl: callbackUrl, appli: String(appli) },
    token,
  ).catch(() => undefined);
}
