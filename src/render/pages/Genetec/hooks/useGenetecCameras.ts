import { useQuery } from "@tanstack/react-query";
import { getGenetecCameras } from "@/render/service/genetec/genetecService";
import {
  GenetecForbiddenError,
  TokenExpiredError
} from "@/render/service/errors";

export const GENETEC_CAMERAS_KEY = ["genetec", "cameras"] as const;

export const useGenetecCameras = () =>
  useQuery({
    queryKey: GENETEC_CAMERAS_KEY,
    queryFn: getGenetecCameras,
    // Auth errors will not fix themselves on retry.
    retry: (count, error) =>
      !(
        error instanceof TokenExpiredError ||
        error instanceof GenetecForbiddenError
      ) && count < 2
  });
