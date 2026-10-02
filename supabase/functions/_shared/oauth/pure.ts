// Provider-independent OAuth helpers (pure; no network or database).

/** Cached rows expire this long after they were fetched (for connectors with cacheDays). */
export function expiresAt(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** A view inside the last fetch is served from the database if that fetch is this recent. */
export const FRESH_MS = 6 * 3600_000;

/** The first day to fetch for a view of `from`…today, or null when the last fetch covers it. */
export function syncWindow(
  from: string,
  last: { synced_from: string | null; synced_at: string | null },
  now: Date,
  freshMs = FRESH_MS,
): string | null {
  const fresh =
    last.synced_at &&
    last.synced_from &&
    last.synced_from <= from &&
    now.getTime() - Date.parse(last.synced_at) < freshMs;
  return fresh ? null : from;
}

/** `url` if it's on an allowed origin (where to send the browser after connecting), else null. */
export function safeReturnTo(url: unknown, allowedOrigins: readonly string[]): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return allowedOrigins.includes(u.origin) ? u.href : null;
  } catch {
    return null;
  }
}

/** `returnTo` with ?oauth=<kind>:<outcome> added, for the app to show what happened. */
export function withOutcome(returnTo: string, kind: string, outcome: string): string {
  const u = new URL(returnTo);
  u.searchParams.set('oauth', `${kind}:${outcome}`);
  return u.href;
}

/** 'YYYY-MM-DD' of a UTC instant, shifted by `days`. */
export function utcDay(epochSeconds: number, days = 0): string {
  return new Date((epochSeconds + days * 86_400) * 1000).toISOString().slice(0, 10);
}
