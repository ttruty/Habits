import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { supabaseAuth } from './auth';

function fakeClient(otpError: Error | null = null) {
  let listener: (event: string, session: unknown) => void = () => {};
  const unsubscribe = vi.fn();
  const auth = {
    onAuthStateChange: vi.fn((l: typeof listener) => {
      listener = l;
      return { data: { subscription: { unsubscribe } } };
    }),
    signInWithOtp: vi.fn(async () => ({ error: otpError })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  return {
    client: { auth } as unknown as SupabaseClient,
    auth,
    unsubscribe,
    emit: (session: unknown) => listener('SIGNED_IN', session),
  };
}

describe('supabaseAuth', () => {
  it('reports the signed-in email and unsubscribes', () => {
    const f = fakeClient();
    const seen: (string | null)[] = [];
    const off = supabaseAuth(f.client, 'https://x/').onChange((e) => seen.push(e));
    f.emit({ user: { email: 'me@example.com' } });
    f.emit(null);
    expect(seen).toEqual(['me@example.com', null]);
    off();
    expect(f.unsubscribe).toHaveBeenCalled();
  });

  it('sends a magic link that never creates a user', async () => {
    const f = fakeClient();
    await supabaseAuth(f.client, 'https://timtruty.com/Habits/').sendLink('me@example.com');
    expect(f.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'me@example.com',
      options: { shouldCreateUser: false, emailRedirectTo: 'https://timtruty.com/Habits/' },
    });
  });

  it('throws when the link is refused, and signs out', async () => {
    const f = fakeClient(new Error('Signups not allowed for otp'));
    const auth = supabaseAuth(f.client, 'https://x/');
    await expect(auth.sendLink('x@example.com')).rejects.toThrow('Signups not allowed');
    await auth.signOut();
    expect(f.auth.signOut).toHaveBeenCalled();
  });
});
