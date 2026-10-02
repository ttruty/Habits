import type { SupabaseClient } from '@supabase/supabase-js';
import type { DateRange, Habit, HabitEvent, Source } from '../model';
import type { DataProvider, IngestToken, NewEvent } from './provider';
import { newIngestToken, sha256Hex } from './tokens';

// Rows as stored (supabase/migrations). owner_id is filled by the database from the session.

export interface SourceRow {
  id: string;
  kind: string;
  label: string;
  config: Record<string, unknown>;
  created_at: string;
}

export interface HabitRow {
  id: string;
  name: string;
  icon: string;
  color: string;
  match: Habit['match'];
  rule: Habit['rule'];
  target: Habit['target'];
  start_date: string | null;
  archived_at: string | null;
  sort: number;
}

export interface EventRow {
  id: string;
  source_id: string;
  external_id: string;
  type: string;
  occurred_at: string;
  local_date: string;
  value: number | null;
  unit: HabitEvent['unit'] | null;
  meta: Record<string, unknown> | null;
}

const EVENT_COLUMNS = 'id,source_id,external_id,type,occurred_at,local_date,value,unit,meta';
/** PostgREST returns at most this many rows per request by default. */
export const PAGE = 1000;

export function toSource(r: SourceRow): Source {
  return {
    id: r.id,
    kind: r.kind as Source['kind'],
    label: r.label,
    config: r.config,
    createdAt: r.created_at,
  };
}

export function toHabit(r: HabitRow): Habit {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    color: r.color,
    match: r.match,
    rule: r.rule,
    target: r.target,
    ...(r.start_date ? { startDate: r.start_date } : {}),
    ...(r.archived_at ? { archivedAt: r.archived_at } : {}),
    sort: r.sort,
  };
}

export function fromHabit(h: Habit): HabitRow {
  return {
    id: h.id,
    name: h.name,
    icon: h.icon,
    color: h.color,
    match: h.match,
    rule: h.rule,
    target: h.target,
    start_date: h.startDate ?? null,
    archived_at: h.archivedAt ?? null,
    sort: h.sort,
  };
}

export function toEvent(r: EventRow): HabitEvent {
  return {
    id: r.id,
    sourceId: r.source_id,
    externalId: r.external_id,
    type: r.type,
    occurredAt: r.occurred_at,
    localDate: r.local_date,
    ...(r.value !== null ? { value: r.value } : {}),
    ...(r.unit !== null ? { unit: r.unit } : {}),
    ...(r.meta !== null ? { meta: r.meta } : {}),
  };
}

export function fromEvent(e: NewEvent): Omit<EventRow, 'id'> {
  return {
    source_id: e.sourceId,
    external_id: e.externalId,
    type: e.type,
    occurred_at: e.occurredAt,
    local_date: e.localDate,
    value: e.value ?? null,
    unit: e.unit ?? null,
    meta: e.meta ?? null,
  };
}

function check({ data, error }: { data: unknown; error: { message: string } | null }): unknown {
  if (error) throw new Error(error.message);
  return data;
}

export interface TokenRow {
  id: string;
  source_id: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function toToken(r: TokenRow): IngestToken {
  return {
    id: r.id,
    sourceId: r.source_id,
    createdAt: r.created_at,
    ...(r.last_used_at ? { lastUsedAt: r.last_used_at } : {}),
    ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
  };
}

export function createSupabaseProvider(db: SupabaseClient, supabaseUrl: string): DataProvider {
  const revoke = async (sourceId: string) =>
    check(
      await db
        .from('ingest_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('source_id', sourceId)
        .is('revoked_at', null),
    );

  return {
    canEdit: true,
    ingestUrl: `${supabaseUrl.replace(/\/$/, '')}/functions/v1/ingest`,

    async listSources() {
      const rows = check(await db.from('sources').select('id,kind,label,config,created_at'));
      return (rows as SourceRow[]).map(toSource);
    },

    async listHabits() {
      const rows = check(
        await db
          .from('habits')
          .select('id,name,icon,color,match,rule,target,start_date,archived_at,sort'),
      );
      return (rows as HabitRow[]).map(toHabit);
    },

    async listEvents({ from, to }: DateRange) {
      const out: HabitEvent[] = [];
      for (let start = 0; ; start += PAGE) {
        const rows = check(
          await db
            .from('events')
            .select(EVENT_COLUMNS)
            .gte('local_date', from)
            .lte('local_date', to)
            .order('local_date')
            .order('id')
            .range(start, start + PAGE - 1),
        ) as EventRow[];
        out.push(...rows.map(toEvent));
        if (rows.length < PAGE) return out;
      }
    },

    async addSource(source) {
      const row = check(
        await db
          .from('sources')
          .insert({ kind: source.kind, label: source.label, config: source.config })
          .select('id,kind,label,config,created_at')
          .single(),
      );
      return toSource(row as SourceRow);
    },

    async saveHabit(habit) {
      check(await db.from('habits').upsert(fromHabit(habit)));
    },

    async saveHabitOrder(ids) {
      await Promise.all(
        ids.map(async (id, sort) => check(await db.from('habits').update({ sort }).eq('id', id))),
      );
    },

    async putEvent(event) {
      check(
        await db.from('events').upsert(fromEvent(event), { onConflict: 'source_id,external_id' }),
      );
    },

    async deleteEvent(id) {
      check(await db.from('events').delete().eq('id', id));
    },

    async listIngestTokens() {
      const rows = check(
        await db.from('ingest_tokens').select('id,source_id,created_at,last_used_at,revoked_at'),
      );
      return (rows as TokenRow[]).map(toToken);
    },

    async issueIngestToken(sourceId) {
      await revoke(sourceId);
      const token = newIngestToken();
      // Insert only: the browser may write a hash but can't read one back (see the migration).
      check(
        await db
          .from('ingest_tokens')
          .insert({ source_id: sourceId, token_hash: await sha256Hex(token) }),
      );
      return token;
    },

    async revokeIngestTokens(sourceId) {
      await revoke(sourceId);
    },
  };
}
