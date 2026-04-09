/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string;
  readonly VITE_ESRI_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
