/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_DEV_BEARER_TOKEN?: string;
  readonly VITE_MEDIA_GATEWAY_URL?: string;
  readonly VITE_GENETEC_PLAYER_MODE?: string;
  readonly VITE_USE_MOCK_API?: string;
}
