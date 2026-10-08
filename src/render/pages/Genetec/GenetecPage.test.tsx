import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/render/locales/i18n";
import GenetecPage from "@/render/pages/Genetec/GenetecPage";
import {
  getEvents,
  registerPlayer
} from "@/render/pages/Genetec/stats/statsCollector";
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

describe("GenetecPage (camera selection)", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("es"));
  beforeEach(() => resetStatsStore());
  afterEach(() => act(() => useStatsStore.getState().stopPhase()));

  const renderPage = async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={client}>
        <GenetecPage />
      </QueryClientProvider>
    );
    await screen.findByText("Cameras 1–4 of 32");
  };
  const cell = (n: number) => screen.getByRole("group", { name: new RegExp(`^Cell ${n}`) });
  const listItem = (name: string) =>
    within(screen.getByRole("complementary")).getByRole("button", { name: new RegExp(name) });

  it("shows the first group and lists the whole catalog", async () => {
    await renderPage();
    expect(within(cell(1)).getByText("Camera 01")).toBeInTheDocument();
    expect(within(cell(4)).getByText("Camera 04")).toBeInTheDocument();
    expect(listItem("Camera 32")).toBeInTheDocument();
  });

  it("assigns a camera to the selected cell by clicking the list", async () => {
    await renderPage();
    fireEvent.click(cell(2));
    fireEvent.click(listItem("Camera 10"));
    expect(within(cell(2)).getByText("Camera 10")).toBeInTheDocument();
    expect(within(listItem("Camera 10")).getByText("Cell 2")).toBeInTheDocument();
    expect(screen.getByText("Custom selection")).toBeInTheDocument();
  });

  it("swaps when the camera is already displayed in another cell", async () => {
    await renderPage();
    fireEvent.click(cell(1));
    fireEvent.click(listItem("Camera 03"));
    expect(within(cell(1)).getByText("Camera 03")).toBeInTheDocument();
    expect(within(cell(3)).getByText("Camera 01")).toBeInTheDocument();
  });

  it("does nothing when a camera is clicked without a selected cell", async () => {
    await renderPage();
    fireEvent.click(listItem("Camera 10"));
    expect(screen.getByText("Cameras 1–4 of 32")).toBeInTheDocument();
  });

  it("clears a cell and shows the placeholder", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Clear cell 1" }));
    expect(within(cell(1)).getByText("Drop or select a camera")).toBeInTheDocument();
    expect(screen.getAllByTestId("player-container")).toHaveLength(3);
  });

  it("moves through the groups with wrap-around", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Next group" }));
    expect(screen.getByText("Cameras 5–8 of 32")).toBeInTheDocument();
    expect(within(cell(1)).getByText("Camera 05")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous group" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous group" }));
    expect(screen.getByText("Cameras 29–32 of 32")).toBeInTheDocument();
  });

  it("keeps the picks when the mosaic grows", async () => {
    await renderPage();
    fireEvent.click(cell(1));
    fireEvent.click(listItem("Camera 20"));
    fireEvent.click(screen.getByRole("button", { name: "8" }));
    await waitFor(() => expect(screen.getAllByTestId("player-container")).toHaveLength(8));
    expect(within(cell(1)).getByText("Camera 20")).toBeInTheDocument();
  });

  it("records camera-assigned events during a phase (and none outside one)", async () => {
    await renderPage();
    fireEvent.click(cell(2));
    fireEvent.click(listItem("Camera 10"));
    expect(getEvents().filter((e) => e.kind === "camera-assigned")).toHaveLength(0);

    act(() => {
      useStatsStore.getState().startPhase({ cameraCount: 4, multiplexed: false });
    });
    fireEvent.click(screen.getByRole("button", { name: "Next group" }));
    const assigned = getEvents().filter((e) => e.kind === "camera-assigned");
    expect(assigned).toHaveLength(4);
    expect(assigned[0]).toMatchObject({
      cellIndex: 0,
      cameraId: "mock-cam-05",
      previousCameraId: "mock-cam-01"
    });
  });
});
