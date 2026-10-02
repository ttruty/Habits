import './components/habits-app';
import { createDemoProvider } from './data/demo-provider';

// Live when built with Supabase settings (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), unless the
// URL has ?demo. Otherwise demo data in this browser. Supabase loads only in live mode.
const app = document.querySelector('habits-app')!;
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const demo = !url || !key || new URLSearchParams(location.search).has('demo');

if (demo) {
  let storage: Storage | null = null;
  try {
    storage = localStorage;
  } catch {
    // Blocked storage: the demo still works, in memory.
  }
  app.provider = createDemoProvider({ storage });
} else {
  const [{ createClient }, { supabaseAuth, linkErrorFromUrl }, { createSupabaseProvider }] =
    await Promise.all([
      import('@supabase/supabase-js'),
      import('./data/auth'),
      import('./data/supabase-provider'),
    ]);
  app.linkError = linkErrorFromUrl(location.hash);
  const client = createClient(url, key);
  app.auth = supabaseAuth(client, new URL(import.meta.env.BASE_URL, location.origin).href);
  app.provider = createSupabaseProvider(client, url);
}
