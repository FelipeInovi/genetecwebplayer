import type { KeyboardEvent } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useTranslation } from "react-i18next";
import GenetecPlayerCell from "@/render/pages/Genetec/components/GenetecPlayerCell";
import type { GenetecCamera } from "@/render/types/genetec";

interface Props {
  index: number;
  /** null: empty cell (placeholder, no player, no gateway session). */
  camera: GenetecCamera | null;
  selected: boolean;
  onSelect: (cellIndex: number) => void;
  onClear: (cellIndex: number) => void;
}

/**
 * One mosaic slot: drop target (camera from the list or another cell),
 * drag source when filled, and selectable (click / Enter / Space) for the
 * click-to-assign flow. The player inside is keyed by the slot, so only a
 * change of camera restarts it.
 */
const GenetecMosaicCell = ({
  index,
  camera,
  selected,
  onSelect,
  onClear
}: Props) => {
  const { t } = useTranslation();
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `mosaic-drop-${index}`,
    data: { type: "mosaic-cell", index }
  });
  const {
    listeners,
    setNodeRef: setDragRef,
    isDragging
  } = useDraggable({
    id: `mosaic-drag-${index}`,
    disabled: !camera,
    data: { type: "mosaic-cell", cameraId: camera?.id }
  });

  const setRefs = (el: HTMLDivElement | null) => {
    setDropRef(el);
    setDragRef(el);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only the cell itself: Enter on the clear button must not select the cell.
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(index);
    }
  };

  const label = camera
    ? `${t("genetec.mosaic.cell", { n: index + 1 })}: ${camera.name}`
    : t("genetec.mosaic.cell", { n: index + 1 });

  return (
    <Box
      ref={setRefs}
      role="group"
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      tabIndex={0}
      {...(camera ? listeners : {})}
      onClick={() => onSelect(index)}
      onKeyDown={onKeyDown}
      sx={{
        position: "relative",
        borderRadius: 1,
        cursor: camera ? "grab" : "pointer",
        opacity: isDragging ? 0.4 : 1,
        outline: "2px solid",
        outlineOffset: -2,
        outlineColor: isOver
          ? "success.main"
          : selected
            ? "primary.main"
            : "transparent"
      }}
    >
      {camera ? (
        <>
          <GenetecPlayerCell camera={camera} />
          <IconButton
            size="small"
            aria-label={t("genetec.mosaic.clear", { n: index + 1 })}
            onClick={(event) => {
              event.stopPropagation();
              onClear(index);
            }}
            sx={{
              position: "absolute",
              top: 2,
              right: 2,
              width: 22,
              height: 22,
              color: "white",
              bgcolor: "rgba(0,0,0,0.55)",
              "&:hover": { bgcolor: "rgba(0,0,0,0.8)" }
            }}
          >
            ×
          </IconButton>
        </>
      ) : (
        <Box
          sx={{
            aspectRatio: "16 / 9",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px dashed",
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "action.hover",
            color: "text.secondary",
            textAlign: "center",
            p: 1
          }}
        >
          <Typography variant="caption">{t("genetec.mosaic.empty")}</Typography>
        </Box>
      )}
    </Box>
  );
};

export default GenetecMosaicCell;
