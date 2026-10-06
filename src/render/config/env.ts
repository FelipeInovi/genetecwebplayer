import type { AppEnv } from "@/render/config/envTypes";

// Single access point to import.meta.env so Jest can swap it for a stub.
const raw = import.meta.env;

const env: AppEnv = {
  VITE_API_URL: raw.VITE_API_URL ?? "",
  VITE_DEV_BEARER_TOKEN: raw.VITE_DEV_BEARER_TOKEN ?? "",
  VITE_MEDIA_GATEWAY_URL: raw.VITE_MEDIA_GATEWAY_URL ?? "",
  VITE_GENETEC_PLAYER_MODE: raw.VITE_GENETEC_PLAYER_MODE ?? "mock",
  VITE_USE_MOCK_API: raw.VITE_USE_MOCK_API ?? "true"
};

export default env;
