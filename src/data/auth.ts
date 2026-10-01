import type { SupabaseClient } from '@supabase/supabase-js';

/** The owner's sign-in. Absent in demo mode. */
export interface Auth {
  /** Called with the signed-in email, or null; once at once, then on every change. */
  onChange(listener: (email: string | null) => void): () => void;
  /** Email a magic link. Fails for any address but the owner's (sign-ups are off). */
  sendLink(email: string): Promise<void>;
  signOut(): Promise<void>;
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
