/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Pankti } from "../models/Pankti";
import { loadPaathAng } from "./paathAngs";
import { joinedPaathTranslation, paathDisplayRows } from "./paathDisplayRows";

vi.mock("./DB", () => ({ DB: { getInstance: async () => ({ select: async (query: string) =>
  JSON.parse(execFileSync("python3", ["-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in c.execute(sys.stdin.read())],ensure_ascii=False))
`, process.env.BANI_TEST_DB!], {input:query,maxBuffer:10*1024*1024}).toString())
}) } }));

const line = (id: string, pair?: string) => ({id,paath_pair_id:pair} as Pankti);

describe("Sukhmani reading rows", () => {
  it("keeps saloks, headings and other banis single while pairing across an ang", () => {
    const pages = paathDisplayRows([
      {ang:262,panktis:[line("salok"),line("heading"),line("first","one")]},
      {ang:263,panktis:[line("second","one"),line("third","two"),line("fourth","two"),line("other")]},
    ]);
    expect(pages.map(page => page.rows.map(row => row.map(pankti => pankti.id))))
      .toEqual([[["salok"],["heading"],["first","second"]],[["third","fourth"],["other"]]]);
    // If the previous ang has been evicted, never shift all later pairings.
    expect(paathDisplayRows([{ang:263,panktis:[line("second","one"),line("third","two"),line("fourth","two")]}])[0].rows
      .map(row => row.map(pankti => pankti.id))).toEqual([["second"],["third","fourth"]]);
  });

  it("joins both translations with a space and handles missing translations", () => {
    const row = [
      {punjabi_translation:" ਪਹਿਲੀ ",english_translation:" First. "},
      {punjabi_translation:" ਦੂਜੀ ",english_translation:" Second. "},
    ] as Pankti[];
    expect(joinedPaathTranslation(row,"punjabi_translation")).toBe("ਪਹਿਲੀ ਦੂਜੀ");
    expect(joinedPaathTranslation(row,"english_translation")).toBe("First. Second.");
    expect(joinedPaathTranslation([{} as Pankti,row[1]],"english_translation")).toBe("Second.");
    expect(joinedPaathTranslation([{} as Pankti],"punjabi_translation")).toBe("—");
  });
});

describe.skipIf(!process.env.BANI_TEST_DB)("complete Sukhmani Sahib reading layout", () => {
  it("pairs every ashtpadi couplet, preserves all saloks and leaves adjacent bani unchanged", async () => {
    const pages = [];
    for (let ang=261;ang<=297;ang++) pages.push({ang,panktis:await loadPaathAng(1,ang)});
    const all = pages.flatMap(page => page.panktis);
    // Independently follow the canonical headers, without relying on the SQL pair IDs.
    const expectedPaired = new Set<string>();
    const salokHeaders = [];
    let ashtpadi = false;
    for (const pankti of all) {
      if (pankti.order_id < 11567 || pankti.order_id > 13593) continue;
      if (pankti.type_id === 2 && pankti.gurmukhi.startsWith("slok")) {ashtpadi=false;salokHeaders.push(pankti.id);}
      if (pankti.type_id === 2 && pankti.gurmukhi.startsWith("AstpdI")) ashtpadi=true;
      if (ashtpadi && [3,4].includes(pankti.type_id)) expectedPaired.add(pankti.id);
    }
    expect(salokHeaders).toHaveLength(24);
    expect(expectedPaired.size).toBe(1922);
    expect(new Set(all.filter(pankti => pankti.paath_pair_id).map(pankti => pankti.id))).toEqual(expectedPaired);
    const rows = paathDisplayRows(pages).flatMap(page => page.rows);
    expect(rows.filter(row => row.length===2)).toHaveLength(961);
    expect(rows.filter(row => row.length===2 && row[0].source_page!==row[1].source_page)).toHaveLength(20);
    expect(rows.flat().map(pankti => pankti.id)).toEqual(all.map(pankti => pankti.id));
    for (const row of rows) {
      if (row.some(pankti => expectedPaired.has(pankti.id))) {
        expect(row).toHaveLength(2);
        expect(row[1].order_id).toBe(row[0].order_id+1);
        expect(row[0].shabad_id).toBe(row[1].shabad_id);
        expect(row[0].paath_pair_id).toBe(row[1].paath_pair_id);
      } else expect(row).toHaveLength(1);
    }
    expect((await loadPaathAng(2,262)).every(pankti => !pankti.paath_pair_id)).toBe(true);
    // Optional browser fixtures use the production loader, not a second SQL implementation.
    if (process.env.PAATH_LAYOUT_FIXTURES) {
      for (const page of pages) writeFileSync(`${process.env.PAATH_LAYOUT_FIXTURES}/paath-ui-fixture-${page.ang}.json`,JSON.stringify(page.panktis));
    }
  }, 30_000);
});
