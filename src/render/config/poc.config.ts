import env from "@/render/config/env";

export type GenetecPlayerMode = "mock" | "gwp";

export interface PocConfig {
  apiURL: string;
  mediaGatewayUrl: string;
  genetecPlayerMode: GenetecPlayerMode;
  useMockApi: boolean;
  /** Tenant flag analogue (MV in broadlineavida). */
  genetecEnabled: boolean;
  /** Deadline for token + start + first Streaming status of one cell. */
  startTimeoutMs: number;
}

const DEFAULT_START_TIMEOUT_MS = 30_000;

const parseStartTimeout = (raw: string): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_START_TIMEOUT_MS;
};

const config: PocConfig = {
  apiURL: env.VITE_API_URL,
  mediaGatewayUrl: env.VITE_MEDIA_GATEWAY_URL,
  genetecPlayerMode: env.VITE_GENETEC_PLAYER_MODE === "gwp" ? "gwp" : "mock",
  useMockApi: env.VITE_USE_MOCK_API !== "false",
  genetecEnabled: true,
  startTimeoutMs: parseStartTimeout(env.VITE_START_TIMEOUT_MS)
};

export default config;
