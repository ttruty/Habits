import '../design/tokens.css';
import './styles/fonts.css';
import './components/habits-app';
import { applyTheme, watchSystemTheme } from './theme';
import { createDemoProvider } from './data/demo-provider';

// Live when built with Supabase settings (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), unless the
// URL has ?demo. Otherwise demo data in this browser. Supabase loads only in live mode.
applyTheme();
watchSystemTheme();

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
  const [
    { createClient },
    { supabaseAuth, linkErrorFromUrl, isAuthRedirect },
    { createSupabaseProvider },
  ] = await Promise.all([
    import('@supabase/supabase-js'),
    import('./data/auth'),
    import('./data/supabase-provider'),
  ]);
  app.linkError = linkErrorFromUrl(location.hash);
  const client = createClient(url, key, {
    auth: { detectSessionInUrl: (u: URL) => isAuthRedirect(u) },
  });
  app.auth = supabaseAuth(client, new URL(import.meta.env.BASE_URL, location.origin).href);
  app.provider = createSupabaseProvider(client, url);
}

// The app shell works offline once installed (scripts/build-sw.mjs). Production only: in dev the
// service worker would serve stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
}
