import {
  loadGwpScript,
  resetGwpLoaderForTests
} from "@/render/pages/Genetec/hooks/loadGwpScript";

const MG = "https://mg.test";

const scripts = () => document.querySelectorAll("script[data-gwp]");
const setGwp = (value: unknown) => {
  (window as unknown as { gwp?: unknown }).gwp = value;
};

describe("loadGwpScript", () => {
  beforeEach(() => {
    resetGwpLoaderForTests();
    document.head.innerHTML = "";
    setGwp(undefined);
  });

  it("injects the script with the Media Gateway URL and resolves on load", async () => {
    const p = loadGwpScript(MG);
    const el = scripts()[0] as HTMLScriptElement;
    expect(el.src).toBe(`${MG}/media/v2/files/gwp.js`);
    setGwp({ buildPlayer: jest.fn() });
    el.dispatchEvent(new Event("load"));
    await expect(p).resolves.toBeDefined();
  });

  it("is a singleton per Media Gateway URL", async () => {
    const a = loadGwpScript(MG);
    const b = loadGwpScript(`${MG}/`);
    expect(a).toBe(b);
    expect(scripts()).toHaveLength(1);
    setGwp({});
    scripts()[0].dispatchEvent(new Event("load"));
    await a;
  });

  it("rejects with a clear error on load failure and allows retry", async () => {
    const p = loadGwpScript(MG);
    scripts()[0].dispatchEvent(new Event("error"));
    await expect(p).rejects.toThrow(/Failed to load GWP script/);
    const retry = loadGwpScript(MG);
    expect(retry).not.toBe(p);
    retry.catch(() => undefined);
  });

  it("rejects on timeout", async () => {
    jest.useFakeTimers();
    try {
      const p = loadGwpScript(MG, 1000);
      const assertion = expect(p).rejects.toThrow(/Timed out/);
      jest.advanceTimersByTime(1001);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects when the script loads but the gwp global is missing", async () => {
    const p = loadGwpScript(MG);
    scripts()[0].dispatchEvent(new Event("load"));
    await expect(p).rejects.toThrow(/global/);
  });
});
