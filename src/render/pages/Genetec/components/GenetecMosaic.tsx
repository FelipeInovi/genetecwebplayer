import { useMemo } from "react";
import { Box } from "@mui/material";
import { GenetecServiceContext } from "@/render/pages/Genetec/components/GenetecServiceContext";
import GenetecMosaicCell from "@/render/pages/Genetec/components/GenetecMosaicCell";
import { getGridColumns } from "@/render/pages/Genetec/components/getGridColumns";
import type { CellAssignment } from "@/render/pages/Genetec/hooks/cellAssignment";
import { useMediaGatewayService } from "@/render/pages/Genetec/hooks/useMediaGatewayService";
import type { GenetecCamera } from "@/render/types/genetec";

interface Props {
  /** The whole catalog (cameras that are not displayed included). */
  cameras: GenetecCamera[];
  /** One camera id (or null) per cell; its length is the cell count. */
  assignment: CellAssignment;
  selectedCell: number | null;
  onSelectCell: (cellIndex: number) => void;
  onClearCell: (cellIndex: number) => void;
  /** true: one shared IMediaGatewayService per mosaic (startWithService). */
  multiplexed?: boolean;
  debugOverlay?: boolean;
  /** Change it to remount the cells (e.g. so first-frame times belong to a test phase). */
  runKey?: number;
}

const GenetecMosaic = ({
  cameras,
  assignment,
  selectedCell,
  onSelectCell,
  onClearCell,
  multiplexed = false,
  debugOverlay = false,
  runKey = 0
}: Props) => {
  const service = useMediaGatewayService(multiplexed, cameras);
  const value = useMemo(
    () => ({ ...service, debugOverlay }),
    [service, debugOverlay]
  );
  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);

  return (
    <GenetecServiceContext.Provider value={value}>
      <Box
        key={runKey}
        sx={{
          display: "grid",
          gap: 1,
          gridTemplateColumns: `repeat(${getGridColumns(assignment.length)}, minmax(0, 1fr))`
        }}
      >
        {assignment.map((cameraId, index) => (
          // Keyed by slot: a cell whose camera did not change never restarts.
          <GenetecMosaicCell
            key={index}
            index={index}
            camera={(cameraId && byId.get(cameraId)) || null}
            selected={selectedCell === index}
            onSelect={onSelectCell}
            onClear={onClearCell}
          />
        ))}
      </Box>
    </GenetecServiceContext.Provider>
  );
};

export default GenetecMosaic;
