import type { SupabaseClient } from '@supabase/supabase-js';

/** The owner's sign-in. Absent in demo mode. */
export interface Auth {
  /** Called with the signed-in email, or null; once at once, then on every change. */
  onChange(listener: (email: string | null) => void): () => void;
  /** Email a magic link. Fails for any address but the owner's (sign-ups are off). */
  sendLink(email: string): Promise<void>;
  signOut(): Promise<void>;
}

/**
 * Whether the page URL is a magic-link return (supabase-js `detectSessionInUrl`). Only the
 * fragment counts: `#access_token=…` or `#error=…&error_code=…`. By default supabase-js also takes
 * `?error=` or `?code=` in the query string as a sign-in attempt, and when that "fails" it skips
 * restoring the stored session, so a stray parameter from another site (an OAuth provider
 * sending you back) looked like being signed out.
 */
export function isAuthRedirect(url: URL): boolean {
  return /(^#|&)(access_token|error_code)=/.test(url.hash);
}

export function supabaseAuth(client: SupabaseClient, redirectTo: string): Auth {
  return {
    onChange(listener) {
      // Fires INITIAL_SESSION straight away, including after a magic-link redirect.
      const { data } = client.auth.onAuthStateChange((_event, session) =>
        listener(session?.user.email ?? null),
      );
      return () => data.subscription.unsubscribe();
    },
    async sendLink(email) {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (error) throw error;
    },
    async signOut() {
      await client.auth.signOut();
    },
  };
}

/** A sign-in error Supabase put in the URL after a magic-link redirect, in plain words. */
export function linkErrorFromUrl(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (!params.get('error')) return '';
  return params.get('error_code') === 'otp_expired'
    ? 'That link has expired or was already used. Send a new one.'
    : "That link didn't work. Send a new one.";
}
