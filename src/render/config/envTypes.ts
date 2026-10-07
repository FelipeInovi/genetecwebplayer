export interface AppEnv {
  VITE_API_URL: string;
  VITE_DEV_BEARER_TOKEN: string;
  VITE_MEDIA_GATEWAY_URL: string;
  VITE_GENETEC_PLAYER_MODE: string;
  VITE_USE_MOCK_API: string;
  /** Optional start deadline override in ms (default 30000). */
  VITE_START_TIMEOUT_MS: string;
}
