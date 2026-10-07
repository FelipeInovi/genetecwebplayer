import { useMemo } from "react";
import { Box } from "@mui/material";
import { GenetecServiceContext } from "@/render/pages/Genetec/components/GenetecServiceContext";
import GenetecPlayerCell from "@/render/pages/Genetec/components/GenetecPlayerCell";
import { getGridColumns } from "@/render/pages/Genetec/components/getGridColumns";
import { useMediaGatewayService } from "@/render/pages/Genetec/hooks/useMediaGatewayService";
import type { GenetecCamera } from "@/render/types/genetec";

interface Props {
  cameras: GenetecCamera[];
  /** How many cameras to show. Default: all. */
  cameraCount?: number;
  /** true: one shared IMediaGatewayService per mosaic (startWithService). */
  multiplexed?: boolean;
  debugOverlay?: boolean;
  /** Change it to remount the cells (e.g. so first-frame times belong to a test phase). */
  runKey?: number;
}

const GenetecMosaic = ({
  cameras,
  cameraCount = cameras.length,
  multiplexed = false,
  debugOverlay = false,
  runKey = 0
}: Props) => {
  const service = useMediaGatewayService(multiplexed, cameras);
  const value = useMemo(
    () => ({ ...service, debugOverlay }),
    [service, debugOverlay]
  );
  const visible = cameras.slice(0, cameraCount);

  return (
    <GenetecServiceContext.Provider value={value}>
      <Box
        key={runKey}
        sx={{
          display: "grid",
          gap: 1,
          gridTemplateColumns: `repeat(${getGridColumns(visible.length)}, minmax(0, 1fr))`
        }}
      >
        {visible.map((camera) => (
          <GenetecPlayerCell key={camera.id} camera={camera} />
        ))}
      </Box>
    </GenetecServiceContext.Provider>
  );
};

export default GenetecMosaic;
