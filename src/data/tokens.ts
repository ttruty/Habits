/** A new ingest token: "hab_" + 32 random bytes, base64url. Shown once, stored only as a hash. */
export function newIngestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes));
  return `hab_${b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
}

/** SHA-256 hex, matching supabase/functions/_shared/ingest.ts. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
