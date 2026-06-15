import { describe, expect, it } from "vitest";
import { cacheUntilFailure, withRetries } from "./once";

describe("cacheUntilFailure", () => {
  it("runs the factory once on success and caches the result", async () => {
    let calls = 0;
    const get = cacheUntilFailure(async () => {
      calls += 1;
      return calls;
    });

    await expect(get()).resolves.toBe(1);
    await expect(get()).resolves.toBe(1);
    await expect(get()).resolves.toBe(1);
    expect(calls).toBe(1);
  });

  it("drops the cache on rejection so the next call retries", async () => {
    let calls = 0;
    const get = cacheUntilFailure(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient first-run failure");
      return "ready";
    });

    await expect(get()).rejects.toThrow("transient first-run failure");
    // Without the reset this would re-throw the cached rejection forever.
    await expect(get()).resolves.toBe("ready");
    await expect(get()).resolves.toBe("ready");
    expect(calls).toBe(2);
  });

  it("does not run the factory concurrently for in-flight callers", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const get = cacheUntilFailure(async () => {
      calls += 1;
      await gate;
      return calls;
    });

    const a = get();
    const b = get();
    release();
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(1);
    expect(calls).toBe(1);
  });
});

describe("withRetries", () => {
  it("returns the first success without retrying", async () => {
    let calls = 0;
    const value = await withRetries(async () => {
      calls += 1;
      return "ok";
    }, { delayMs: 0 });
    expect(value).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries transient failures and resolves once one succeeds", async () => {
    let calls = 0;
    const value = await withRetries(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "recovered";
    }, { attempts: 3, delayMs: 0 });
    expect(value).toBe("recovered");
    expect(calls).toBe(3);
  });

  it("rethrows the last error after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      withRetries(async () => {
        calls += 1;
        throw new Error(`fail-${calls}`);
      }, { attempts: 3, delayMs: 0 }),
    ).rejects.toThrow("fail-3");
    expect(calls).toBe(3);
  });
});
