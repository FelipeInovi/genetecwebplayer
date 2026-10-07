import { resolveDevBearerToken } from "@/render/config/devToken";

export interface AppEnv {
  VITE_API_URL: string;
  VITE_DEV_BEARER_TOKEN: string;
  VITE_MEDIA_GATEWAY_URL: string;
  VITE_GENETEC_PLAYER_MODE: string;
  VITE_USE_MOCK_API: string;
  /** Optional start deadline override in ms (default 30000). */
  VITE_START_TIMEOUT_MS: string;
}

// Single access point to import.meta.env so Jest can swap it for a stub.
const raw = import.meta.env;

const env: AppEnv = {
  VITE_API_URL: raw.VITE_API_URL ?? "",
  // Dev-only: ignored in production builds even if it somehow got inlined.
  VITE_DEV_BEARER_TOKEN: resolveDevBearerToken(raw.DEV, raw.VITE_DEV_BEARER_TOKEN),
  VITE_MEDIA_GATEWAY_URL: raw.VITE_MEDIA_GATEWAY_URL ?? "",
  VITE_GENETEC_PLAYER_MODE: raw.VITE_GENETEC_PLAYER_MODE ?? "mock",
  VITE_USE_MOCK_API: raw.VITE_USE_MOCK_API ?? "true",
  VITE_START_TIMEOUT_MS: raw.VITE_START_TIMEOUT_MS ?? ""
};

export default env;
