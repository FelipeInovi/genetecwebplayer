import { memo, useMemo, useState } from "react";
import {
  Box,
  Chip,
  List,
  ListItemButton,
  Paper,
  TextField,
  Typography
} from "@mui/material";
import { useDraggable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import type { CellAssignment } from "@/render/pages/Genetec/hooks/cellAssignment";
import type { GenetecCamera } from "@/render/types/genetec";

interface ItemProps {
  camera: GenetecCamera;
  /** 0-based cell that displays it, or -1. */
  cellIndex: number;
  onPick: (cameraId: string) => void;
}

const CameraItem = memo(function CameraItem({
  camera,
  cellIndex,
  onPick
}: ItemProps) {
  const { t } = useTranslation();
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `camera-drag-${camera.id}`,
    data: { type: "camera", cameraId: camera.id }
  });

  return (
    <ListItemButton
      ref={setNodeRef}
      {...listeners}
      onClick={() => onPick(camera.id)}
      selected={cellIndex >= 0}
      sx={{ gap: 1, opacity: isDragging ? 0.4 : 1, cursor: "grab" }}
    >
      <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
        {camera.name}
      </Typography>
      {cellIndex >= 0 && (
        <Chip
          size="small"
          variant="outlined"
          label={t("genetec.mosaic.cell", { n: cellIndex + 1 })}
        />
      )}
      <Chip
        size="small"
        color={
          camera.status === "online"
            ? "success"
            : camera.status === "offline"
              ? "error"
              : "default"
        }
        label={t(`genetec.cameraList.status.${camera.status}`)}
      />
    </ListItemButton>
  );
});

interface Props {
  /** The whole catalog. */
  cameras: GenetecCamera[];
  assignment: CellAssignment;
  selectedCell: number | null;
  /** Click-to-assign: the camera the user picked (the page decides where it goes). */
  onPick: (cameraId: string) => void;
}

/**
 * Searchable catalog. Items are drag sources (dropped on a mosaic cell by the
 * page's DndContext) and plain buttons for the click / keyboard flow.
 */
const GenetecCameraList = ({
  cameras,
  assignment,
  selectedCell,
  onPick
}: Props) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? cameras.filter((c) => c.name.toLowerCase().includes(query))
      : cameras;
  }, [cameras, search]);

  return (
    <Paper
      variant="outlined"
      component="aside"
      sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}
    >
      <Typography variant="subtitle2">
        {t("genetec.cameraList.title")} ({cameras.length})
      </Typography>
      <TextField
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("genetec.cameraList.search")}
        inputProps={{ "aria-label": t("genetec.cameraList.search") }}
      />
      {selectedCell === null && (
        <Typography variant="caption" color="text.secondary">
          {t("genetec.cameraList.hint")}
        </Typography>
      )}
      <Box sx={{ maxHeight: 560, overflowY: "auto" }}>
        <List dense disablePadding>
          {visible.map((camera) => (
            <CameraItem
              key={camera.id}
              camera={camera}
              cellIndex={assignment.indexOf(camera.id)}
              onPick={onPick}
            />
          ))}
        </List>
        {visible.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            {t("genetec.cameraList.noResults")}
          </Typography>
        )}
      </Box>
    </Paper>
  );
};

export default GenetecCameraList;
