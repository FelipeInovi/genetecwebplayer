import "@testing-library/jest-dom";

// jsdom does not implement canvas; keep the console clean.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as HTMLCanvasElement["getContext"];
}
