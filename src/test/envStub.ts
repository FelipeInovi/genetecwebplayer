// Jest stand-in for src/render/config/env.ts (which reads import.meta.env).
// Tests may override values via jest.mock("@/render/config/env", ...).
import type { AppEnv } from "@/render/config/envTypes";

const env: AppEnv = {
  VITE_API_URL: "http://api.test",
  VITE_DEV_BEARER_TOKEN: "",
  VITE_MEDIA_GATEWAY_URL: "https://mg.test",
  VITE_GENETEC_PLAYER_MODE: "mock",
  VITE_USE_MOCK_API: "true"
};

export default env;
