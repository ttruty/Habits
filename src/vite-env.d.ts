/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Set at build time in vite.config.ts. */
declare const __APP_VERSION__: string;
/** Full commit sha, or '' outside a git checkout. */
declare const __APP_COMMIT__: string;
/** Build date, YYYY-MM-DD. */
declare const __APP_BUILT__: string;
