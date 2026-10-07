import {
  Box,
  Button,
  FormControlLabel,
  Paper,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  buildEventsCsv,
  buildSamplesCsv,
  buildSummaryCsv,
  downloadCsv
} from "@/render/pages/Genetec/stats/csv";
import {
  getEvents,
  getSamples,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";
import { CAMERA_COUNTS } from "@/render/types/genetecMetrics";

const GenetecTestPanel = () => {
  const { t } = useTranslation();
  const cameraCount = useStatsStore((s) => s.cameraCount);
  const multiplexed = useStatsStore((s) => s.multiplexed);
  const debugOverlay = useStatsStore((s) => s.debugOverlay);
  const activePhaseId = useStatsStore((s) => s.activePhaseId);
  const phases = useStatsStore((s) => s.phases);
  // Derived counters only: raw samples/events are read on demand (export).
  const sampleCount = useStatsStore((s) => s.sampleCount);
  const errorCount = useStatsStore((s) => s.errorCount);
  const reconnectionCount = useStatsStore((s) => s.reconnectionCount);
  const { setCameraCount, setMultiplexed, setDebugOverlay, startPhase, stopPhase } =
    useStatsStore.getState();

  const running = activePhaseId !== null;

  const exportCsv = () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { getSummaries } = useStatsStore.getState();
    downloadCsv(`genetec-samples-${stamp}.csv`, buildSamplesCsv(getSamples()));
    downloadCsv(`genetec-summary-${stamp}.csv`, buildSummaryCsv(getSummaries()));
    downloadCsv(`genetec-events-${stamp}.csv`, buildEventsCsv(getEvents()));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        {t("genetec.test.title")}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2 }}>
        <Typography variant="body2">{t("genetec.test.cameras")}</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={cameraCount}
          onChange={(_, value: number | null) => value && setCameraCount(value)}
          aria-label={t("genetec.test.cameras")}
        >
          {CAMERA_COUNTS.map((n) => (
            <ToggleButton key={n} value={n} disabled={running}>
              {n}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <FormControlLabel
          control={
            <Switch
              checked={multiplexed}
              disabled={running}
              onChange={(e) => setMultiplexed(e.target.checked)}
            />
          }
          label={t("genetec.test.multiplexed")}
        />
        <FormControlLabel
          control={
            <Switch
              checked={debugOverlay}
              onChange={(e) => setDebugOverlay(e.target.checked)}
            />
          }
          label={t("genetec.test.debugOverlay")}
        />
        <Button variant="contained" size="small" disabled={running} onClick={startPhase}>
          {t("genetec.test.startPhase")}
        </Button>
        <Button variant="outlined" size="small" disabled={!running} onClick={stopPhase}>
          {t("genetec.test.stopPhase")}
        </Button>
        <Button
          variant="outlined"
          size="small"
          disabled={sampleCount === 0 && phases.length === 0}
          onClick={exportCsv}
        >
          {t("genetec.test.exportCsv")}
        </Button>
      </Box>
      <Typography variant="caption" component="div" sx={{ mt: 1 }}>
        {running
          ? t("genetec.test.running", { phase: activePhaseId })
          : t("genetec.test.idle")}
        {" · "}
        {t("genetec.test.counters", {
          samples: sampleCount,
          errors: errorCount,
          reconnections: reconnectionCount
        })}
      </Typography>
    </Paper>
  );
};

export default GenetecTestPanel;
