import type {
  GenetecCamera,
  GenetecTokenResponse
} from "@/render/types/genetec";

const CENTER = { lat: 6.2442, lng: -75.5812 };
const MOCK_COUNT = 32;
const OFFLINE_INDEXES = new Set([5, 13, 21, 29]);
const UNKNOWN_INDEXES = new Set([9]);
const TOKEN_TTL_MS = 5 * 60_000;

const pad = (n: number, len: number) => String(n).padStart(len, "0");

const statusFor = (i: number): GenetecCamera["status"] => {
  if (OFFLINE_INDEXES.has(i)) return "offline";
  if (UNKNOWN_INDEXES.has(i)) return "unknown";
  return "online";
};

/** Deterministic fixtures: same cameras on every call. */
export const buildMockCameras = (): GenetecCamera[] =>
  Array.from({ length: MOCK_COUNT }, (_, i) => ({
    id: `mock-cam-${pad(i + 1, 2)}`,
    externalId: `00000000-0000-4000-8000-${pad(i + 1, 12)}`,
    name: `Camera ${pad(i + 1, 2)}`,
    provider: "genetec" as const,
    status: statusFor(i),
    lat: CENTER.lat + ((i % 8) - 3.5) * 0.006,
    lng: CENTER.lng + (Math.floor(i / 8) - 1.5) * 0.008,
    ptz: i % 4 === 0
  }));

export const buildMockToken = (): GenetecTokenResponse => ({
  token: `mock-token-${Math.random().toString(36).slice(2)}`,
  expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  mediaGatewayUrl: "https://mock-media-gateway.invalid"
});

export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
