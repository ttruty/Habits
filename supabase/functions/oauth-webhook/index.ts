// Webhooks from OAuth providers: /oauth-webhook/<kind>.
//
// The provider answers its own checks (Strava's hub.challenge, Withings' HEAD) and turns a POST
// into hints. Neither signs its webhooks, so a hint only ever triggers a refetch with our own token:
// a forged POST can at most cause a refetch. The reply goes out at once; the work happens after.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { oauthApp, oauthProviders } from '../_shared/oauth/registry.ts';
import { applyHint } from '../_shared/oauth/store.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

Deno.serve(async (req) => {
  const kind = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  const provider = oauthProviders[kind];
  if (!provider) return new Response('Not found', { status: 404 });

  const { response, hints } = await provider.webhook(req);
  const app = oauthApp(kind);
  const url = `${SUPABASE_URL}/functions/v1/oauth-webhook/${kind}`;
  EdgeRuntime.waitUntil(
    (async () => {
      for (const hint of hints) {
        await applyHint(db, provider, app, url, hint).catch((e) =>
          console.error(`${kind} webhook failed`, e),
        );
      }
    })(),
  );
  return response;
});
