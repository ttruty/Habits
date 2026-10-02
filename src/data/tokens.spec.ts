import { expect, it } from 'vitest';
import { sha256Hex as serverHash } from '../../supabase/functions/_shared/ingest.ts';
import { newIngestToken, sha256Hex } from './tokens';

it('makes long, url-safe, unique tokens', () => {
  const a = newIngestToken();
  expect(a).toMatch(/^hab_[A-Za-z0-9_-]{43}$/);
  expect(newIngestToken()).not.toBe(a);
});

it('hashes exactly like the ingest function', async () => {
  const token = newIngestToken();
  expect(await sha256Hex(token)).toBe(await serverHash(token));
});
