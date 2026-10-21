import {
  forgetStreamed,
  hasStreamed,
  markStreamed,
  resetStreamed
} from "@/render/pages/Genetec/hooks/streamedCameras";

describe("streamedCameras", () => {
  beforeEach(() => resetStreamed());

  it("tells a camera that reached Streaming from one that did not", () => {
    expect(hasStreamed("cam-1")).toBe(false);
    markStreamed("cam-1");
    expect(hasStreamed("cam-1")).toBe(true);
    expect(hasStreamed("cam-2")).toBe(false);
  });

  it("forgets a camera", () => {
    markStreamed("cam-1");
    forgetStreamed("cam-1");
    expect(hasStreamed("cam-1")).toBe(false);
  });
});
