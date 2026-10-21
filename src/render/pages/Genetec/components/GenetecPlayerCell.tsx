import { useRef } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useGenetecPlayer } from "@/render/pages/Genetec/hooks/useGenetecPlayer";
import {
  CameraOfflineError,
  GenetecForbiddenError,
  TokenExpiredError
} from "@/render/service/errors";
import type { GenetecCamera } from "@/render/types/genetec";

const errorKey = (error: Error | null): string => {
  if (error instanceof TokenExpiredError) return "genetec.errors.tokenExpired";
  if (error instanceof GenetecForbiddenError) return "genetec.errors.forbidden";
  if (error instanceof CameraOfflineError) return "genetec.errors.offline";
  return "genetec.errors.generic";
};

interface Props {
  camera: GenetecCamera;
}

const GenetecPlayerCell = ({ camera }: Props) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const { status, error } = useGenetecPlayer(containerRef, camera);

  return (
    <Box
      sx={{
        position: "relative",
        aspectRatio: "16 / 9",
        bgcolor: "black",
        overflow: "hidden",
        borderRadius: 1
      }}
    >
      <div
        ref={containerRef}
        data-testid="player-container"
        style={{ width: "100%", height: "100%" }}
      />
      <Typography
        variant="caption"
        sx={{
          position: "absolute",
          top: 4,
          left: 8,
          color: "white",
          textShadow: "0 0 3px black"
        }}
      >
        {camera.name}
      </Typography>
      {status === "loading" && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            color: "white"
          }}
        >
          <CircularProgress size={20} />
          <Typography variant="caption">
            {t("genetec.player.loading")}
          </Typography>
        </Box>
      )}
      {status === "error" && (
        <Box
          role="alert"
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 1,
            textAlign: "center",
            bgcolor: "rgba(0,0,0,0.75)",
            color: "error.light"
          }}
        >
          <Typography variant="caption">
            {t(errorKey(error))}
            {errorKey(error) === "genetec.errors.generic" && error
              ? `: ${error.message}`
              : ""}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default GenetecPlayerCell;
