import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/render/locales/i18n";
import GenetecPage from "@/render/pages/Genetec/GenetecPage";
import { registerPlayer } from "@/render/pages/Genetec/stats/statsCollector";
import {
  resetStatsStore,
  useStatsStore
} from "@/render/pages/Genetec/stats/statsStore";

describe("GenetecPage (smoke)", () => {
  it("renders the title and the mosaic with mock cameras", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <GenetecPage />
      </QueryClientProvider>
    );
    expect(screen.getByText(/Genetec Web Player/)).toBeInTheDocument();
    expect(
      await screen.findByText("32 cámaras", { exact: false })
    ).toBeInTheDocument();
    expect(await screen.findAllByTestId("player-container")).toHaveLength(4);
  });

  it("resizes the mosaic from the test panel selection", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <GenetecPage />
      </QueryClientProvider>
    );
    expect(await screen.findAllByTestId("player-container")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "8" }));
    expect(await screen.findAllByTestId("player-container")).toHaveLength(8);
  });

  it("stops the active phase and its polling timer on unmount", async () => {
    jest.useFakeTimers();
    try {
      resetStatsStore();
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } }
      });
      const { unmount } = render(
        <QueryClientProvider client={client}>
          <GenetecPage />
        </QueryClientProvider>
      );
      act(() => {
        useStatsStore.getState().startPhase({ cameraCount: 4, multiplexed: false });
      });
      const getter = jest.fn().mockResolvedValue({ fps: 25 });
      const off = registerPlayer("cam-x", getter);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(getter).toHaveBeenCalledTimes(1);
      unmount();
      expect(useStatsStore.getState().activePhaseId).toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(getter).toHaveBeenCalledTimes(1);
      off();
    } finally {
      jest.useRealTimers();
      resetStatsStore();
    }
  });
});
