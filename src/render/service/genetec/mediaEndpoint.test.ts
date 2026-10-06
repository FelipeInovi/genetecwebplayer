import { getMediaEndpoint } from "@/render/service/genetec/mediaEndpoint";

describe("getMediaEndpoint", () => {
  it("appends /media to the base URL", () => {
    expect(getMediaEndpoint("https://mg.test:8443")).toBe(
      "https://mg.test:8443/media"
    );
  });

  it("normalizes trailing slashes", () => {
    expect(getMediaEndpoint("https://mg.test/")).toBe("https://mg.test/media");
    expect(getMediaEndpoint("https://mg.test///")).toBe(
      "https://mg.test/media"
    );
  });

  it("does not duplicate /media when already present", () => {
    expect(getMediaEndpoint("https://mg.test/media/")).toBe(
      "https://mg.test/media"
    );
  });
});
