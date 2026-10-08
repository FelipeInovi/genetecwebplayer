import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "@/render/locales/i18n";
import poc from "@/render/config/poc.config";
import GenetecMosaic from "@/render/pages/Genetec/components/GenetecMosaic";
import { loadGwpScript } from "@/render/pages/Genetec/hooks/loadGwpScript";
import { getGenetecToken } from "@/render/service/genetec/genetecService";
import type { GenetecCamera } from "@/render/types/genetec";

jest.mock("@/render/service/genetec/genetecService", () => ({
  getGenetecToken: jest.fn()
}));
jest.mock("@/render/pages/Genetec/hooks/loadGwpScript", () => ({
  loadGwpScript: jest.fn()
}));

const cam = (n: number): GenetecCamera => ({
  id: `c${n}`,
  externalId: `guid-${n}`,
  name: `Camera ${n}`,
  provider: "genetec",
  status: "online",
  lat: null,
  lng: null,
  ptz: false
});
const catalog = Array.from({ length: 12 }, (_, i) => cam(i + 1));

const noop = () => undefined;
const renderMosaic = (
  assignment: Array<string | null>,
  extra: Partial<React.ComponentProps<typeof GenetecMosaic>> = {}
) =>
  render(
    <GenetecMosaic
      cameras={catalog}
      assignment={assignment}
      selectedCell={null}
      onSelectCell={noop}
      onClearCell={noop}
      {...extra}
    />
  );

describe("GenetecMosaic (assignment, mock player)", () => {
  beforeAll(() => {
    poc.genetecPlayerMode = "mock";
    return i18n.changeLanguage("en");
  });
  afterAll(() => i18n.changeLanguage("es"));

  it("renders a player per assigned cell and a placeholder per empty cell", () => {
    renderMosaic(["c1", null, "c3", null]);
    expect(screen.getAllByTestId("player-container")).toHaveLength(2);
    expect(screen.getAllByText("Drop or select a camera")).toHaveLength(2);
    expect(screen.getByText("Camera 1")).toBeInTheDocument();
    expect(screen.getByText("Camera 3")).toBeInTheDocument();
  });

  it("selects a cell when it is clicked, empty or not", () => {
    const onSelectCell = jest.fn();
    renderMosaic(["c1", null], { onSelectCell });
    fireEvent.click(screen.getByRole("group", { name: /Cell 2/ }));
    expect(onSelectCell).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("group", { name: /Cell 1/ }));
    expect(onSelectCell).toHaveBeenLastCalledWith(0);
  });

  it("selects a cell from the keyboard", () => {
    const onSelectCell = jest.fn();
    renderMosaic(["c1", null], { onSelectCell });
    fireEvent.keyDown(screen.getByRole("group", { name: /Cell 2/ }), {
      key: "Enter"
    });
    expect(onSelectCell).toHaveBeenLastCalledWith(1);
  });

  it("marks the selected cell", () => {
    renderMosaic(["c1", null], { selectedCell: 1 });
    expect(screen.getByRole("group", { name: /Cell 2/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
    expect(screen.getByRole("group", { name: /Cell 1/ })).not.toHaveAttribute(
      "aria-current"
    );
  });

  it("clears only a filled cell, without selecting it", () => {
    const onClearCell = jest.fn();
    const onSelectCell = jest.fn();
    renderMosaic(["c1", null], { onClearCell, onSelectCell });
    expect(screen.getAllByRole("button", { name: /Clear cell/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear cell 1" }));
    expect(onClearCell).toHaveBeenCalledWith(0);
    expect(onSelectCell).not.toHaveBeenCalled();
  });

  it("ignores assigned ids that are not in the catalog", () => {
    renderMosaic(["ghost", "c2"]);
    expect(screen.getAllByTestId("player-container")).toHaveLength(1);
    expect(screen.getAllByText("Drop or select a camera")).toHaveLength(1);
  });
});

type Handler = (payload: never) => void;
const makeEvent = () => ({
  register: jest.fn((_h: Handler) => undefined),
  unregister: jest.fn((_h: Handler) => undefined)
});
const makePlayer = () => ({
  onErrorStateRaised: makeEvent(),
  onStreamStatusChanged: makeEvent(),
  onPlayerStateChanged: makeEvent(),
  onFrameRendered: makeEvent(),
  isStarted: true,
  start: jest.fn().mockResolvedValue(undefined),
  startWithService: jest.fn().mockResolvedValue(undefined),
  playLive: jest.fn(),
  stop: jest.fn(),
  dispose: jest.fn(),
  showDebugOverlay: jest.fn(),
  getPlayerStats: jest.fn().mockResolvedValue({})
});

describe("GenetecMosaic (player lifecycle when the assignment changes, gwp mode)", () => {
  const service = { dispose: jest.fn() };
  let players: ReturnType<typeof makePlayer>[];
  const gwp = {
    buildPlayer: jest.fn(),
    buildMediaGatewayService: jest.fn()
  };

  beforeEach(() => {
    poc.genetecPlayerMode = "gwp";
    poc.mediaGatewayUrl = "https://mg.test";
    jest.clearAllMocks();
    players = [];
    gwp.buildPlayer.mockImplementation(() => {
      const p = makePlayer();
      players.push(p);
      return p;
    });
    gwp.buildMediaGatewayService.mockResolvedValue(service);
    (loadGwpScript as jest.Mock).mockResolvedValue(gwp);
    (getGenetecToken as jest.Mock).mockResolvedValue({
      token: "tok",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      mediaGatewayUrl: "x"
    });
  });
  afterAll(() => {
    poc.genetecPlayerMode = "mock";
  });

  const mosaic = (assignment: Array<string | null>, multiplexed = false) => (
    <GenetecMosaic
      cameras={catalog}
      assignment={assignment}
      selectedCell={null}
      onSelectCell={noop}
      onClearCell={noop}
      multiplexed={multiplexed}
    />
  );
  const started = () => players.filter((p) => p.playLive.mock.calls.length > 0);
  const startedGuids = () =>
    players.flatMap((p) => p.start.mock.calls.map((c) => c[0]));

  it("next group restarts exactly the 4 cells", async () => {
    const { rerender } = render(mosaic(["c1", "c2", "c3", "c4"]));
    await waitFor(() => expect(started()).toHaveLength(4));
    rerender(mosaic(["c5", "c6", "c7", "c8"]));
    await waitFor(() => expect(started()).toHaveLength(8));
    expect(gwp.buildPlayer).toHaveBeenCalledTimes(8);
    expect(
      players.slice(0, 4).every((p) => p.dispose.mock.calls.length === 1)
    ).toBe(true);
    expect(
      players.slice(4).every((p) => p.dispose.mock.calls.length === 0)
    ).toBe(true);
    expect(startedGuids().slice(4)).toEqual([
      "guid-5",
      "guid-6",
      "guid-7",
      "guid-8"
    ]);
  });

  it("assigning a camera to one cell restarts only that cell", async () => {
    const { rerender } = render(mosaic(["c1", "c2", "c3", "c4"]));
    await waitFor(() => expect(started()).toHaveLength(4));
    rerender(mosaic(["c1", "c9", "c3", "c4"]));
    await waitFor(() => expect(started()).toHaveLength(5));
    expect(gwp.buildPlayer).toHaveBeenCalledTimes(5);
    expect(players[1].dispose).toHaveBeenCalledTimes(1);
    expect(
      [0, 2, 3].every((i) => players[i].dispose.mock.calls.length === 0)
    ).toBe(true);
    expect(players[4].start).toHaveBeenCalledWith(
      "guid-9",
      "https://mg.test/media",
      expect.any(Function)
    );
  });

  it("releases the old session before the new one starts in the same cell", async () => {
    const { rerender } = render(mosaic(["c1"]));
    await waitFor(() => expect(started()).toHaveLength(1));
    rerender(mosaic(["c2"]));
    await waitFor(() => expect(players[1]?.start).toHaveBeenCalled());
    expect(players[0].stop.mock.invocationCallOrder[0]).toBeLessThan(
      players[0].dispose.mock.invocationCallOrder[0]
    );
    expect(players[0].dispose.mock.invocationCallOrder[0]).toBeLessThan(
      players[1].start.mock.invocationCallOrder[0]
    );
  });

  it("releases the session when a cell is cleared and starts nothing", async () => {
    const { rerender } = render(mosaic(["c1", "c2"]));
    await waitFor(() => expect(started()).toHaveLength(2));
    rerender(mosaic(["c1", null]));
    expect(players[1].dispose).toHaveBeenCalledTimes(1);
    await act(async () => undefined);
    expect(gwp.buildPlayer).toHaveBeenCalledTimes(2);
    expect(players[0].dispose).not.toHaveBeenCalled();
  });

  it("multiplexed: every cell uses startWithService on the shared service, also after a change", async () => {
    const { rerender } = render(mosaic(["c1", "c2"], true));
    await waitFor(() => expect(started()).toHaveLength(2));
    expect(gwp.buildMediaGatewayService).toHaveBeenCalledTimes(1);
    rerender(mosaic(["c1", "c7"], true));
    await waitFor(() => expect(started()).toHaveLength(3));
    expect(players.every((p) => p.start.mock.calls.length === 0)).toBe(true);
    expect(players[2].startWithService).toHaveBeenCalledWith("guid-7", service);
    expect(players[0].startWithService).toHaveBeenCalledTimes(1);
    expect(gwp.buildMediaGatewayService).toHaveBeenCalledTimes(1);
    expect(service.dispose).not.toHaveBeenCalled();
  });
});
