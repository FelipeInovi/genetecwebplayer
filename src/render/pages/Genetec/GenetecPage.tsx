import {
  Alert,
  Box,
  CircularProgress,
  Container,
  Typography
} from "@mui/material";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import config from "@/render/config/poc.config";
import GenetecCameraList from "@/render/pages/Genetec/components/GenetecCameraList";
import GenetecGroupNav from "@/render/pages/Genetec/components/GenetecGroupNav";
import GenetecMosaic from "@/render/pages/Genetec/components/GenetecMosaic";
import GenetecTestPanel from "@/render/pages/Genetec/components/GenetecTestPanel";
import { resolveDrop } from "@/render/pages/Genetec/components/resolveDrop";
import { diffAssignment } from "@/render/pages/Genetec/hooks/cellAssignment";
import { useCellAssignment } from "@/render/pages/Genetec/hooks/useCellAssignment";
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


  // Which camera shows in which cell. Page state (not the stats store): it is
  // what the user is looking at, the harness only observes it.
  const cameraIds = useMemo(() => cameras.map((c) => c.id), [cameras]);
  const {
    assignment,
    selectedCell,
    selectCell,
    assign,
    assignToSelected,
    clear,
    next,
    previous
  } = useCellAssignment(cameraIds, testConfig.cameraCount);

  // Mid-phase changes show up in the events CSV (ignored outside a phase).
  const reportedAssignment = useRef(assignment);
  useEffect(() => {
    diffAssignment(reportedAssignment.current, assignment).forEach((c) =>
      statsTelemetry.onCameraAssigned?.(c.cellIndex, c.cameraId, c.previousCameraId)
    );
    reportedAssignment.current = assignment;
  }, [assignment]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const draggedCamera = cameras.find((c) => c.id === draggedId);
  const onDragStart = useCallback(
    (event: DragStartEvent) =>
      setDraggedId(
        (event.active.data.current?.cameraId as string | undefined) ?? null
      ),
    []
  );
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDraggedId(null);
      const drop = resolveDrop(
        event.active.data.current,
        event.over?.data.current
      );
      if (drop) assign(drop.cellIndex, drop.cameraId);
    },
    [assign]
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
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDraggedId(null)}
        >
          <Box
            sx={{
              display: "grid",
              gap: 2,
              gridTemplateColumns: { xs: "1fr", md: "300px minmax(0, 1fr)" },
              alignItems: "start"
            }}
          >
            {!isLoading && !error && (
              <GenetecCameraList
                cameras={cameras}
                assignment={assignment}
                selectedCell={selectedCell}
                onPick={assignToSelected}
              />
            )}
            <Box sx={{ gridColumn: { md: 2 }, minWidth: 0 }}>
              <GenetecTestPanel
                config={testConfig}
                onConfigChange={updateTestConfig}
              />
              {!isLoading && !error && (
                <>
                  <GenetecGroupNav
                    assignment={assignment}
                    cameraIds={cameraIds}
                    onPrevious={previous}
                    onNext={next}
                  />
                  <GenetecMosaic
                    cameras={cameras}
                    assignment={assignment}
                    selectedCell={selectedCell}
                    onSelectCell={selectCell}
                    onClearCell={clear}
                    multiplexed={testConfig.multiplexed}
                    debugOverlay={testConfig.debugOverlay}
                    runKey={runKey}
                  />
                </>
              )}
            </Box>
          </Box>
          <DragOverlay>
            {draggedCamera && (
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  bgcolor: "background.paper",
                  border: "1px solid",
                  borderColor: "primary.main",
                  borderRadius: 1,
                  boxShadow: 4
                }}
              >
                <Typography variant="body2">{draggedCamera.name}</Typography>
              </Box>
            )}
          </DragOverlay>
        </DndContext>
      </Container>
    </GenetecTelemetryContext.Provider>
  );
};

export default GenetecPage;
