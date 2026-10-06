import { Box } from "@mui/material";
import { GenetecServiceContext } from "@/render/pages/Genetec/components/GenetecServiceContext";
import GenetecPlayerCell from "@/render/pages/Genetec/components/GenetecPlayerCell";
import { getGridColumns } from "@/render/pages/Genetec/components/getGridColumns";
import { useMediaGatewayService } from "@/render/pages/Genetec/hooks/useMediaGatewayService";
import { useStatsStore } from "@/render/pages/Genetec/stats/statsStore";
import type { GenetecCamera } from "@/render/types/genetec";

interface Props {
  cameras: GenetecCamera[];
}

/**
 * Cell count, multiplexed mode and the remount key come from the test store
 * (GenetecTestPanel). Multiplexed: one shared IMediaGatewayService per mosaic.
 */
const GenetecMosaic = ({ cameras }: Props) => {
  const cameraCount = useStatsStore((s) => s.cameraCount);
  const multiplexed = useStatsStore((s) => s.multiplexed);
  const runKey = useStatsStore((s) => s.runKey);
  const service = useMediaGatewayService(multiplexed, cameras);
  const visible = cameras.slice(0, cameraCount);

  return (
    <GenetecServiceContext.Provider value={service}>
      <Box
        // Remount on phase start so first-frame times belong to the phase.
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
