/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare const __APP_VERSION__: string;

interface Window {
  /** Defined by the index.html boot-watchdog; main.ts calls it once the bundle
   *  executes, cancelling the watchdog's reload timer. */
  __webmapBootOk?: () => void;
}

interface ImportMetaEnv {
  readonly VITE_ESRI_API_KEY: string;
  readonly VITE_THUNDERFOREST_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
