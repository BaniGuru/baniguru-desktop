/// <reference types="node" />
import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { getPaathSource, loadPaathAng } from "./paathAngs";

vi.mock("./DB", () => ({ DB:{getInstance: async () => ({select:async (query: string) =>
  JSON.parse(execFileSync("python3",["-c",`
import sqlite3,json,sys
c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); c.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in c.execute(sys.argv[2])],ensure_ascii=False))
`,process.env.BANI_TEST_DB!,query]).toString())})} }));

describe.skipIf(!process.env.BANI_TEST_DB)("paath angs from the production database", () => {
  beforeAll(() => expect(process.env.BANI_TEST_DB).toBeTruthy());
  it("loads complete ordered angs with all three columns and no duplicate translation rows", async () => {
    expect(await getPaathSource("823")).toEqual({id:1,length:1430,pageName:"Ang"});
    const pages = await Promise.all([15,16,17,18].map(ang => loadPaathAng(1,ang)));
    for (const [index,lines] of pages.entries()) {
      expect(lines.length).toBeGreaterThan(10);
      expect(new Set(lines.map(row => row.id)).size).toBe(lines.length);
      expect(lines.every(row => row.source_page === 15 + index)).toBe(true);
      expect(lines.map(row => row.order_id)).toEqual(lines.map(row => row.order_id).sort((a,b) => a-b));
      expect(lines.every(row => Array.isArray(row.gurmukhi_words))).toBe(true);
      expect(lines.some(row => row.punjabi_translation && row.english_translation)).toBe(true);
    }
  });
});
