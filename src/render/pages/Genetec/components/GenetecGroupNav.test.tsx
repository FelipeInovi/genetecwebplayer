import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/render/locales/i18n";
import GenetecGroupNav from "@/render/pages/Genetec/components/GenetecGroupNav";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i + 1}`);

const renderNav = (assignment: Array<string | null>, total = 32) => {
  const onPrevious = jest.fn();
  const onNext = jest.fn();
  render(
    <GenetecGroupNav
      assignment={assignment}
      cameraIds={ids(total)}
      onPrevious={onPrevious}
      onNext={onNext}
    />
  );
  return { onPrevious, onNext };
};

describe("GenetecGroupNav", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("es"));

  it("labels a contiguous group with its catalog range", () => {
    renderNav(["c5", "c6", "c7", "c8"]);
    expect(screen.getByText("Cameras 5–8 of 32")).toBeInTheDocument();
  });

  it("labels a custom selection", () => {
    renderNav(["c5", "c20", "c7", "c8"]);
    expect(screen.getByText("Custom selection")).toBeInTheDocument();
  });

  it("calls next and previous", () => {
    const { onNext, onPrevious } = renderNav(["c1", "c2", "c3", "c4"]);
    fireEvent.click(screen.getByRole("button", { name: "Next group" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Previous group" }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons when every camera already fits in the mosaic", () => {
    renderNav(["c1", "c2", null, null], 2);
    expect(screen.getByRole("button", { name: "Next group" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous group" })).toBeDisabled();
  });
});
