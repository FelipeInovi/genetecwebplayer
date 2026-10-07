import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/render/locales/i18n";
import GenetecTestPanel from "@/render/pages/Genetec/components/GenetecTestPanel";
import { recordError } from "@/render/pages/Genetec/stats/statsCollector";
import {
  resetStatsStore,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";
import {
  DEFAULT_TEST_CONFIG,
  type TestConfig
} from "@/render/types/genetecMetrics";

const renderPanel = (config: Partial<TestConfig> = {}) => {
  const onConfigChange = jest.fn();
  render(
    <GenetecTestPanel
      config={{ ...DEFAULT_TEST_CONFIG, ...config }}
      onConfigChange={onConfigChange}
    />
  );
  return { onConfigChange };
};

describe("GenetecTestPanel (smoke)", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("es"));
  beforeEach(() => resetStatsStore());
  afterEach(() => useStatsStore.getState().stopPhase());

  it("reports camera count and mode changes to the page", () => {
    const { onConfigChange } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "16" }));
    expect(onConfigChange).toHaveBeenLastCalledWith({ cameraCount: 16 });
    fireEvent.click(screen.getByLabelText(/multiplexed/i));
    expect(onConfigChange).toHaveBeenLastCalledWith({ multiplexed: true });
  });

  it("starts a phase with the configured count and mode, then stops it", () => {
    renderPanel({ cameraCount: 16, multiplexed: true });
    fireEvent.click(screen.getByRole("button", { name: /start phase/i }));
    const store = useStatsStore.getState();
    expect(store.activePhaseId).not.toBeNull();
    expect(store.phases[0]).toMatchObject({ cameraCount: 16, multiplexed: true });
    expect(screen.getByRole("button", { name: /stop phase/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /stop phase/i }));
    expect(useStatsStore.getState().activePhaseId).toBeNull();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeEnabled();
  });

  it("reports the debug overlay toggle to the page", () => {
    const { onConfigChange } = renderPanel();
    fireEvent.click(screen.getByLabelText(/debug overlay/i));
    expect(onConfigChange).toHaveBeenCalledWith({ debugOverlay: true });
  });

  it("shows the derived counters from the store, not raw arrays (C3)", () => {
    renderPanel();
    act(() =>
      useStatsStore.setState({
        sampleCount: 7,
        errorCount: 2,
        reconnectionCount: 1
      })
    );
    expect(
      screen.getByText(/Samples: 7 · Errors: 2 · Reconnections: 1/)
    ).toBeInTheDocument();
  });

  it("exports the raw arrays on demand (C3)", () => {
    const urls: string[] = [];
    const blobs: Blob[] = [];
    URL.createObjectURL = jest.fn((b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      urls.push("blob:x");
      return "blob:x";
    });
    URL.revokeObjectURL = jest.fn();
    renderPanel();
    const store = useStatsStore.getState();
    act(() => {
      store.startPhase({ cameraCount: 4, multiplexed: false });
      recordError("cam-a", {
        code: 1,
        isFatal: false,
        message: "m",
        source: "gwp-error"
      });
      store.stopPhase();
    });
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(blobs).toHaveLength(3);
  });
});
