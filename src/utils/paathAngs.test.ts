import { describe, expect, it, vi } from "vitest";
import { PaathAngCache, paathAngRange } from "./paathAngs";
vi.mock("./DB", () => ({DB:{}}));

describe("bounded paath ang loading", () => {
  it("keeps previous, current and upcoming angs within the source", () => {
    expect(paathAngRange(16,1430)).toEqual([15,16,17,18]);
    expect(paathAngRange(1,1430)).toEqual([1,2,3,4]);
    expect(paathAngRange(1430,1430)).toEqual([1427,1428,1429,1430]);
    expect(paathAngRange(1,2)).toEqual([1,2]);
  });
  it("reuses overlapping pages, evicts old ones and stays bounded over all 1430 angs", async () => {
    const load = vi.fn(async () => []);
    const cache = new PaathAngCache(load);
    await cache.window(paathAngRange(16,1430));
    await cache.window(paathAngRange(16,1430));
    expect(load).toHaveBeenCalledTimes(4);
    await cache.window(paathAngRange(17,1430));
    expect(load).toHaveBeenCalledTimes(5);
    for (let ang = 18; ang <= 1430; ang++) {
      const pages = await cache.window(paathAngRange(ang,1430));
      expect(cache.size).toBeLessThanOrEqual(4);
      expect(pages.some(page => page.ang === ang)).toBe(true);
    }
    await cache.window(paathAngRange(16,1430));
    expect(load).toHaveBeenCalledTimes(1420);
  });
  it("shares in-flight requests and retries failed queries", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("SQL busy")).mockResolvedValue([]);
    const cache = new PaathAngCache(load);
    await expect(cache.window([1])).rejects.toThrow("SQL busy");
    await Promise.all([cache.window([1,2]),cache.window([1,2])]);
    expect(load).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(2);
  });
});
