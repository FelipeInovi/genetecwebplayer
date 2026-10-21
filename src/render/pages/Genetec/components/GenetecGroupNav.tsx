import { Box, Button, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  describeGroup,
  type CellAssignment
} from "@/render/pages/Genetec/hooks/cellAssignment";

interface Props {
  assignment: CellAssignment;
  /** The whole catalog, in order. */
  cameraIds: string[];
  onPrevious: () => void;
  onNext: () => void;
}

/** Previous / next group buttons with a "Cameras 5–8 of 32" label. */
const GenetecGroupNav = ({
  assignment,
  cameraIds,
  onPrevious,
  onNext
}: Props) => {
  const { t } = useTranslation();
  const range = describeGroup(assignment, cameraIds);
  // Nothing to page through when the whole catalog is already on screen.
  const single = cameraIds.length <= assignment.length;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
      <Button size="small" variant="outlined" disabled={single} onClick={onPrevious}>
        {t("genetec.group.previous")}
      </Button>
      <Typography variant="body2" sx={{ minWidth: 160, textAlign: "center" }}>
        {range ? t("genetec.group.range", { ...range }) : t("genetec.group.custom")}
      </Typography>
      <Button size="small" variant="outlined" disabled={single} onClick={onNext}>
        {t("genetec.group.next")}
      </Button>
    </Box>
  );
};

export default GenetecGroupNav;
