// POST /functions/v1/ingest — token-authenticated batch intake for first-party apps.
//
//   Authorization: Bearer <ingest token>
//   { "events": [{ externalId, type, occurredAt, localDate, value?, unit?, meta? }, …] }   (≤ 100)
//
// → 200 { accepted, updated, duplicates, rejected: [{ index, error }] }
//   400 bad body · 401 unknown or revoked token · 405 not POST
//
// Deployed with verify_jwt = false (supabase/config.toml): the ingest token is the credential.
// The service role writes on the token owner's behalf; RLS doesn't apply to it.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { serverConnectorFor } from '../_shared/connectors/registry.ts';
import { bearer, corsHeaders, parseBatch, sha256Hex, toRow } from '../_shared/ingest.ts';

const DEFAULT_ORIGINS = [
  'https://timtruty.com',
  'http://localhost:4200', // DeckFit (ng serve)
  'http://localhost:4310', // DeckFit e2e
  'http://localhost:8100', // MindDrive, Yarnbeard (ionic serve)
];
const allowedOrigins = (Deno.env.get('INGEST_ALLOWED_ORIGINS') ?? DEFAULT_ORIGINS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin'), allowedOrigins);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' });

  const token = bearer(req.headers.get('authorization'));
  if (!token) return reply(401, { error: 'Missing ingest token' });

  const { data: auth, error: authError } = await db
    .from('ingest_tokens')
    .select('id, owner_id, source_id, sources(kind)')
    .eq('token_hash', await sha256Hex(token))
    .is('revoked_at', null)
    .maybeSingle();
  if (authError) return reply(500, { error: 'Lookup failed' });
  const kind = (auth?.sources as { kind?: string } | null)?.kind;
  const connector = kind ? serverConnectorFor(kind) : undefined;
  if (!auth || !connector?.ingest) return reply(401, { error: 'Unknown or revoked ingest token' });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'Body must be JSON' });
  }
  const parsed = parseBatch(body, connector);
  if (!parsed.ok) return reply(400, { error: parsed.error });

  const { events, rejected } = parsed;
  let accepted = 0;
  let updated = 0;
  let duplicates = 0;

  if (events.length) {
    const { data: existing, error: existingError } = await db
      .from('events')
      .select('external_id')
      .eq('source_id', auth.source_id)
      .in(
        'external_id',
        events.map((e) => e.externalId),
      );
    if (existingError) return reply(500, { error: 'Lookup failed' });
    const known = new Set((existing ?? []).map((r) => r.external_id as string));

    const rows = events.map((e) => toRow(e, auth.owner_id, auth.source_id));
    const { error: writeError } = await db.from('events').upsert(rows, {
      onConflict: 'source_id,external_id',
      ignoreDuplicates: connector.onConflict === 'ignore',
    });
    if (writeError) return reply(500, { error: 'Write failed' });

    accepted = events.filter((e) => !known.has(e.externalId)).length;
    if (connector.onConflict === 'update') updated = known.size;
    else duplicates = known.size;
  }

  await db
    .from('ingest_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', auth.id);

  return reply(200, { accepted, updated, duplicates, rejected });
});
