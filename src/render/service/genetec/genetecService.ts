import config from "@/render/config/poc.config";
import apiLV from "@/render/service/apiLV";
import {
  buildMockCameras,
  buildMockToken,
  delay
} from "@/render/service/genetec/mocks";
import type {
  GenetecCamera,
  GenetecTokenResponse
} from "@/render/types/genetec";

// POC-only: simulated latency of the mock backend.
const MOCK_DELAY_MS = 150;

export const getGenetecCameras = async (): Promise<GenetecCamera[]> => {
  // POC-only: mock backend (drop this branch when migrating).
  if (config.useMockApi) {
    await delay(MOCK_DELAY_MS);
    return buildMockCameras();
  }
  const { data } = await apiLV.get<GenetecCamera[]>("/genetec/cameras");
  return data;
};

export const getGenetecToken = async (
  cameraId: string
): Promise<GenetecTokenResponse> => {
  // POC-only: mock backend (drop this branch when migrating).
  if (config.useMockApi) {
    await delay(MOCK_DELAY_MS);
    return buildMockToken();
  }
  const { data } = await apiLV.post<GenetecTokenResponse>("/genetec/token", {
    cameraId
  });
  return data;
};
