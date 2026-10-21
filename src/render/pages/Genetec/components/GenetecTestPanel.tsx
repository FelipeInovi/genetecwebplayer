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
import { useShallow } from "zustand/react/shallow";
import {
  buildEventsCsv,
  buildSamplesCsv,
  buildSummaryCsv,
  downloadCsv
} from "@/render/pages/Genetec/stats/csv";
import {
  getEvents,
  getSamples
} from "@/render/pages/Genetec/stats/statsCollector";
import { useStatsStore } from "@/render/pages/Genetec/stats/statsStore";
import {
  CAMERA_COUNTS,
  type CameraCount,
  type TestConfig
} from "@/render/types/genetecMetrics";

interface Props {
  config: TestConfig;
  onConfigChange: (patch: Partial<TestConfig>) => void;
}

const GenetecTestPanel = ({ config, onConfigChange }: Props) => {
  const { t } = useTranslation();
  const { cameraCount, multiplexed, debugOverlay } = config;
  // Phase lifecycle and derived counters only: raw samples/events are read on demand (export).
  const { activePhaseId, phases, sampleCount, errorCount, reconnectionCount } =
    useStatsStore(
      useShallow((s) => ({
        activePhaseId: s.activePhaseId,
        phases: s.phases,
        sampleCount: s.sampleCount,
        errorCount: s.errorCount,
        reconnectionCount: s.reconnectionCount
      }))
    );
  const { startPhase, stopPhase } = useStatsStore.getState();

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
          onChange={(_, value: CameraCount | null) =>
            value && onConfigChange({ cameraCount: value })
          }
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
              onChange={(e) => onConfigChange({ multiplexed: e.target.checked })}
            />
          }
          label={t("genetec.test.multiplexed")}
        />
        <FormControlLabel
          control={
            <Switch
              checked={debugOverlay}
              onChange={(e) => onConfigChange({ debugOverlay: e.target.checked })}
            />
          }
          label={t("genetec.test.debugOverlay")}
        />
        <Button
          variant="contained"
          size="small"
          disabled={running}
          onClick={() => startPhase({ cameraCount, multiplexed })}
        >
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
