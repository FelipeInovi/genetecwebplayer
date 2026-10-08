import { fireEvent, render, screen, within } from "@testing-library/react";
import i18n from "@/render/locales/i18n";
import GenetecCameraList from "@/render/pages/Genetec/components/GenetecCameraList";
import type { GenetecCamera } from "@/render/types/genetec";

const cam = (
  n: number,
  name = `Camera ${n}`,
  status: GenetecCamera["status"] = "online"
): GenetecCamera => ({
  id: `c${n}`,
  externalId: `guid-${n}`,
  name,
  provider: "genetec",
  status,
  lat: null,
  lng: null,
  ptz: false
});

const cameras = [
  cam(1, "Lobby entrance"),
  cam(2, "Parking north", "offline"),
  cam(3, "Parking south"),
  cam(4, "Roof")
];

const renderList = (
  extra: Partial<React.ComponentProps<typeof GenetecCameraList>> = {}
) => {
  const onPick = jest.fn();
  render(
    <GenetecCameraList
      cameras={cameras}
      assignment={["c1", null, "c3", null]}
      selectedCell={null}
      onPick={onPick}
      {...extra}
    />
  );
  return { onPick };
};

describe("GenetecCameraList", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("es"));

  it("lists every camera with its status", () => {
    renderList();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    const parking = screen.getByRole("button", { name: /Parking north/ });
    expect(within(parking).getByText("Offline")).toBeInTheDocument();
    const lobby = screen.getByRole("button", { name: /Lobby entrance/ });
    expect(within(lobby).getByText("Online")).toBeInTheDocument();
  });

  it("shows which cell displays a camera", () => {
    renderList();
    expect(
      within(screen.getByRole("button", { name: /Lobby entrance/ })).getByText(
        "Cell 1"
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Parking south/ })).getByText(
        "Cell 3"
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Roof/ })).queryByText(/Cell/)
    ).toBeNull();
  });

  it("filters by name, ignoring case", () => {
    renderList();
    fireEvent.change(screen.getByRole("textbox", { name: "Search by name" }), {
      target: { value: "PARKING" }
    });
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByText("Roof")).toBeNull();
  });

  it("says so when nothing matches", () => {
    renderList();
    fireEvent.change(screen.getByRole("textbox", { name: "Search by name" }), {
      target: { value: "zzz" }
    });
    expect(screen.getByText("No cameras match your search.")).toBeInTheDocument();
  });

  it("reports the clicked camera", () => {
    const { onPick } = renderList({ selectedCell: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Roof/ }));
    expect(onPick).toHaveBeenCalledWith("c4");
  });

  it("explains the click flow until a cell is selected", () => {
    const { rerender } = render(
      <GenetecCameraList
        cameras={cameras}
        assignment={[null]}
        selectedCell={null}
        onPick={jest.fn()}
      />
    );
    expect(screen.getByText(/Select a cell, then click a camera/)).toBeInTheDocument();
    rerender(
      <GenetecCameraList
        cameras={cameras}
        assignment={[null]}
        selectedCell={0}
        onPick={jest.fn()}
      />
    );
    expect(screen.queryByText(/Select a cell, then click a camera/)).toBeNull();
  });
});
