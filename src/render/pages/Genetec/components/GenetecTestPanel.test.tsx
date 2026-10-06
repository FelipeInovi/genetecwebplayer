import { fireEvent, render, screen } from "@testing-library/react";
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
});
