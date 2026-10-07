import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Typography
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import config from "@/render/config/poc.config";
import GenetecMosaic from "@/render/pages/Genetec/components/GenetecMosaic";
import GenetecTestPanel from "@/render/pages/Genetec/components/GenetecTestPanel";
import { useGenetecCameras } from "@/render/pages/Genetec/hooks/useGenetecCameras";
import { GenetecTelemetryContext } from "@/render/pages/Genetec/components/GenetecTelemetryContext";
import { statsTelemetry } from "@/render/pages/Genetec/stats/statsTelemetry";
import { useStatsStore } from "@/render/pages/Genetec/stats/statsStore";
import {
  GenetecForbiddenError,
  TokenExpiredError
} from "@/render/service/errors";
import {
  DEFAULT_TEST_CONFIG,
  type TestConfig
} from "@/render/types/genetecMetrics";

const GenetecPage = () => {
  const { t } = useTranslation();
  const { data: cameras = [], isLoading, error } = useGenetecCameras();
  // Load-test harness wiring: UI settings live here, stats are the telemetry.
  const [testConfig, setTestConfig] = useState<TestConfig>(DEFAULT_TEST_CONFIG);
  const runKey = useStatsStore((s) => s.runKey);
  const updateTestConfig = useCallback(
    (patch: Partial<TestConfig>) =>
      setTestConfig((prev) => ({ ...prev, ...patch })),
    []
  );

  // The polling timer is module-level: it must not outlive the page.
  useEffect(() => () => useStatsStore.getState().stopPhase(), []);

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
    <GenetecTelemetryContext.Provider value={statsTelemetry}>
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
        <GenetecTestPanel
          config={testConfig}
          onConfigChange={updateTestConfig}
        />
        {!isLoading && !error && (
          <GenetecMosaic
            cameras={cameras}
            cameraCount={testConfig.cameraCount}
            multiplexed={testConfig.multiplexed}
            debugOverlay={testConfig.debugOverlay}
            runKey={runKey}
          />
        )}
      </Container>
    </GenetecTelemetryContext.Provider>
  );
};

export default GenetecPage;
