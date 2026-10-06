import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Typography
} from "@mui/material";
import { useTranslation } from "react-i18next";
import config from "@/render/config/poc.config";
import GenetecMosaic from "@/render/pages/Genetec/components/GenetecMosaic";
import GenetecTestPanel from "@/render/pages/Genetec/components/GenetecTestPanel";
import { useGenetecCameras } from "@/render/pages/Genetec/hooks/useGenetecCameras";
import {
  GenetecForbiddenError,
  TokenExpiredError
} from "@/render/service/errors";

const GenetecPage = () => {
  const { t } = useTranslation();
  const { data: cameras = [], isLoading, error } = useGenetecCameras();

  if (!config.genetecEnabled) {
    return <Alert severity="info">{t("genetec.disabled")}</Alert>;
  }

  const listError = () => {
    if (error instanceof TokenExpiredError)
      return t("genetec.errors.tokenExpired");
    if (error instanceof GenetecForbiddenError)
      return t("genetec.errors.forbidden");
    return t("genetec.errors.cameras");
  };

  return (
    <Container maxWidth={false} sx={{ py: 3 }}>
      <Typography variant="h5" gutterBottom>
        {t("genetec.title")}
      </Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>
        {t("genetec.cameraCount", { count: cameras.length })} ·{" "}
        {t("genetec.mode", { mode: config.genetecPlayerMode })}
      </Typography>
      {isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
          <CircularProgress />
        </Box>
      )}
      {error && <Alert severity="error">{listError()}</Alert>}
      <GenetecTestPanel />
      {!isLoading && !error && <GenetecMosaic cameras={cameras} />}
    </Container>
  );
};

export default GenetecPage;
