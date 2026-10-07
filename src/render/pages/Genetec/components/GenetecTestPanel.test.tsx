import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/render/locales/i18n";
import GenetecTestPanel from "@/render/pages/Genetec/components/GenetecTestPanel";
import {
  resetStatsStore,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";

describe("GenetecTestPanel (smoke)", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("es"));
  beforeEach(() => resetStatsStore());
  afterEach(() => useStatsStore.getState().stopPhase());

  it("selects camera count and mode, then starts and stops a phase", () => {
    render(<GenetecTestPanel />);
    fireEvent.click(screen.getByRole("button", { name: "16" }));
    fireEvent.click(screen.getByLabelText(/multiplexed/i));
    expect(useStatsStore.getState().cameraCount).toBe(16);
    expect(useStatsStore.getState().multiplexed).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /start phase/i }));
    expect(useStatsStore.getState().activePhaseId).not.toBeNull();
    expect(screen.getByRole("button", { name: /stop phase/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /stop phase/i }));
    expect(useStatsStore.getState().activePhaseId).toBeNull();
    expect(screen.getByRole("button", { name: /export csv/i })).toBeEnabled();
  });

  it("toggles the debug overlay flag", () => {
    render(<GenetecTestPanel />);
    fireEvent.click(screen.getByLabelText(/debug overlay/i));
    expect(useStatsStore.getState().debugOverlay).toBe(true);
  });

  it("shows the derived counters from the store, not raw arrays (C3)", () => {
    render(<GenetecTestPanel />);
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
    render(<GenetecTestPanel />);
    const store = useStatsStore.getState();
    act(() => {
      store.startPhase();
      store.recordError("cam-a", { code: 1, isFatal: false, message: "m" });
      store.stopPhase();
    });
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(blobs).toHaveLength(3);
  });
});
