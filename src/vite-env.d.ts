/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string;
  readonly VITE_ESRI_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
