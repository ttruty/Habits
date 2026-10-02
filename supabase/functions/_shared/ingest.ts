// Pure /ingest logic, shared by the Edge Function and its unit tests (no Deno or network here).

import type { ServerConnector } from './connectors/types.ts';

export const MAX_BATCH = 100;
const UNITS = ['count', 'seconds', 'meters', 'pages', 'percent'] as const;
const MAX_META_BYTES = 4096;

export interface IngestEvent {
  externalId: string;
  type: string;
  occurredAt: string;
  localDate: string;
  value?: number;
  unit?: (typeof UNITS)[number];
  meta?: Record<string, unknown>;
}

export interface Rejected {
  index: number;
  error: string;
}

export type ParsedBatch =
  { ok: true; events: IngestEvent[]; rejected: Rejected[] } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A real calendar day, 'YYYY-MM-DD'. */
export function isDateKey(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Why `raw` isn't a valid event for this connector, or null if it is. */
export function eventError(raw: unknown, connector: ServerConnector): string | null {
  if (!isObject(raw)) return 'not an object';
  const { externalId, type, occurredAt, localDate, value, unit, meta } = raw;
  if (typeof externalId !== 'string' || !externalId || externalId.length > 200) {
    return 'externalId must be a string of 1–200 characters';
  }
  if (typeof type !== 'string' || !connector.types.includes(type)) {
    return `type must be one of: ${connector.types.join(', ')}`;
  }
  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) {
    return 'occurredAt must be an ISO timestamp';
  }
  if (!isDateKey(localDate)) return 'localDate must be YYYY-MM-DD';
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    return 'value must be a finite number';
  }
  if (unit !== undefined && !UNITS.includes(unit as IngestEvent['unit'] & string)) {
    return `unit must be one of: ${UNITS.join(', ')}`;
  }
  if (meta !== undefined) {
    if (!isObject(meta)) return 'meta must be an object';
    if (new TextEncoder().encode(JSON.stringify(meta)).length > MAX_META_BYTES) {
      return `meta must be under ${MAX_META_BYTES} bytes`;
    }
  }
  return null;
}

/**
 * Validate a request body `{ events: [...] }`. Bad events are rejected one by one, so a queue
 * holding one broken event doesn't block the rest. A later copy of the same externalId replaces an
 * earlier one in the batch.
 */
export function parseBatch(body: unknown, connector: ServerConnector): ParsedBatch {
  if (!isObject(body) || !Array.isArray(body.events)) {
    return { ok: false, error: 'Body must be { "events": [...] }' };
  }
  if (body.events.length > MAX_BATCH) {
    return { ok: false, error: `At most ${MAX_BATCH} events per request` };
  }
  const rejected: Rejected[] = [];
  const byId = new Map<string, IngestEvent>();
  body.events.forEach((raw, index) => {
    const error = eventError(raw, connector);
    if (error) {
      rejected.push({ index, error });
      return;
    }
    const e = raw as Record<string, unknown>;
    const event: IngestEvent = {
      externalId: e.externalId as string,
      type: e.type as string,
      occurredAt: new Date(e.occurredAt as string).toISOString(),
      localDate: e.localDate as string,
      ...(e.value !== undefined ? { value: e.value as number } : {}),
      ...(e.unit !== undefined ? { unit: e.unit as IngestEvent['unit'] } : {}),
      ...(e.meta !== undefined ? { meta: e.meta as Record<string, unknown> } : {}),
    };
    byId.delete(event.externalId); // keep the latest copy, in its latest position
    byId.set(event.externalId, event);
  });
  return { ok: true, events: [...byId.values()], rejected };
}

/** An events row for the database. */
export function toRow(e: IngestEvent, ownerId: string, sourceId: string) {
  return {
    owner_id: ownerId,
    source_id: sourceId,
    external_id: e.externalId,
    type: e.type,
    occurred_at: e.occurredAt,
    local_date: e.localDate,
    value: e.value ?? null,
    unit: e.unit ?? null,
    meta: e.meta ?? null,
  };
}

/** Bearer token from an Authorization header. */
export function bearer(header: string | null): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

/** SHA-256 hex. Tokens are stored only as this hash. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** CORS headers: the request's origin if it's allowed, nothing otherwise. */
export function corsHeaders(
  origin: string | null,
  allowed: readonly string[],
): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}
