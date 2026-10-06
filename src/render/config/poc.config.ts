import env from "@/render/config/env";

export type GenetecPlayerMode = "mock" | "gwp";

export interface PocConfig {
  apiURL: string;
  mediaGatewayUrl: string;
  genetecPlayerMode: GenetecPlayerMode;
  useMockApi: boolean;
  /** Tenant flag analogue (MV in broadlineavida). */
  genetecEnabled: boolean;
}

const config: PocConfig = {
  apiURL: env.VITE_API_URL,
  mediaGatewayUrl: env.VITE_MEDIA_GATEWAY_URL,
  genetecPlayerMode: env.VITE_GENETEC_PLAYER_MODE === "gwp" ? "gwp" : "mock",
  useMockApi: env.VITE_USE_MOCK_API !== "false",
  genetecEnabled: true
};

export default config;
