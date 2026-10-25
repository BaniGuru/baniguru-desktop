/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Pankti } from "../models/Pankti";
import { loadPaathAng } from "./paathAngs";
import { joinedPaathTranslation, paathDisplayRows, paathWordCount } from "./paathDisplayRows";

vi.mock("./DB", () => ({ DB: { getInstance: async () => ({ select: async (query: string) =>
  JSON.parse(execFileSync("python3", ["-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in c.execute(sys.stdin.read())],ensure_ascii=False))
`, process.env.BANI_TEST_DB!], {input:query,maxBuffer:10*1024*1024}).toString())
}) } }));

const line = (id: string, pair?: string) => ({id,paath_pair_id:pair,gurmukhi:"one two",type_id:4,shabad_id:"test",source_id:1} as Pankti);

describe("Sukhmani reading rows", () => {
  it("keeps saloks and headings single while pairing canonical slots across an ang", () => {
    const pages = paathDisplayRows([
      {ang:262,panktis:[{...line("salok"),paath_keep_single:1},{...line("heading"),type_id:2},line("first","one")]},
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
  it("respects the twelve-word cap, canonical slots and all Sukhmani saloks", async () => {
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
    const sukhmani=all.filter(pankti=>pankti.order_id>=11567&&pankti.order_id<=13593);
    expect(new Set(sukhmani.filter(pankti => pankti.paath_pair_id).map(pankti => pankti.id))).toEqual(expectedPaired);
    expect(all.filter(pankti => pankti.order_id >= 11567 && pankti.order_id <= 13593 &&
      !expectedPaired.has(pankti.id)).every(pankti => Boolean(pankti.paath_keep_single))).toBe(true);
    const rows = paathDisplayRows(pages).flatMap(page => page.rows);
    const slots=new Map<string,Pankti[]>();
    for(const pankti of sukhmani.filter(p=>p.paath_pair_id)) {
      const slot=slots.get(pankti.paath_pair_id!)??[];slot.push(pankti);slots.set(pankti.paath_pair_id!,slot);
    }
    const eligible=[...slots.values()].filter(slot=>slot.length===2&&slot.reduce((n,p)=>n+paathWordCount(p.gurmukhi),0)<=12);
    const sukhmaniPairs=rows.filter(row=>row.length===2&&expectedPaired.has(row[0].id));
    expect(sukhmaniPairs).toHaveLength(eligible.length);
    expect(sukhmaniPairs.filter(row=>row[0].source_page!==row[1].source_page)).toHaveLength(
      eligible.filter(row=>row[0].source_page!==row[1].source_page).length);
    expect(rows.flat().map(pankti=>pankti.id)).toEqual(all.map(pankti=>pankti.id));
    for(const row of rows) {
      if(row.length===2) {
        expect(row[1].order_id).toBe(row[0].order_id+1);
        expect(row[0].shabad_id).toBe(row[1].shabad_id);
        expect(row[0].paath_pair_id).toBe(row[1].paath_pair_id);
        expect(row.reduce((n,p)=>n+paathWordCount(p.gurmukhi),0)).toBeLessThanOrEqual(12);
      }
      if(row.some(p=>p.paath_keep_single)) expect(row).toHaveLength(1);
    }
    // A page loaded without its neighbors still retains its full paragraph's
    // pair slots; its leading half cannot shift every later couplet.
    const independent=await loadPaathAng(1,277);
    expect(independent.map(p=>p.paath_pair_id)).toEqual(pages.find(page=>page.ang===277)!.panktis.map(p=>p.paath_pair_id));
    expect((await loadPaathAng(2,262)).every(pankti=>!pankti.paath_keep_single)).toBe(true);
    // Optional browser fixtures use the production loader, not a second SQL implementation.
    if (process.env.PAATH_LAYOUT_FIXTURES) {
      for (const page of pages) writeFileSync(`${process.env.PAATH_LAYOUT_FIXTURES}/paath-ui-fixture-${page.ang}.json`,JSON.stringify(page.panktis));
    }
  }, 30_000);
});

describe("paragraph pairs and word limits",()=>{
  const verse=(id:string,gurmukhi:string,extra:Partial<Pankti>={})=>({id,type_id:4,shabad_id:"one",source_id:1,source_page:179,gurmukhi,...extra} as Pankti);
  const ids=(panktis:Pankti[])=>paathDisplayRows([{ang:179,panktis}])[0].rows.map(row=>row.map(p=>p.id));
  it("counts attached/chained numbering as punctuation rather than words",()=>{
    for(const ending of ["]1]", "]3]", "]1]3]", "॥੧॥", "॥੧॥੩॥", "||1||3||"]) {
      expect(paathWordCount("one two three four five six"+ending)).toBe(6);
      expect(paathWordCount("ਇਕ ਦੋ ਤਿੰਨ ਚਾਰ ਪੰਜ ਛੇ "+ending)).toBe(6);
    }
  });
  it("joins six plus six words, including numbering, but rejects thirteen",()=>{
    expect(ids([verse("a","one two three four five six ]"),verse("b","one two three four five six]1]")])).toEqual([["a","b"]]);
    expect(ids([verse("a","one two three four five six seven ]"),verse("b","one two three four five six ]1]")])).toEqual([["a"],["b"]]);
    // Short words and uneven line lengths use the same twelve-word total.
    expect(ids([verse("a","a b c d ]"),verse("b","e f g h i j k l ]1]")])).toEqual([["a","b"]]);
  });
  it("resets after a numbered ending and never shifts the next paragraph's pairs",()=>{
    expect(ids([verse("a","one ]3]"),verse("b","two three four five six ]"),verse("c","seven eight nine ten eleven ]"),
      verse("d","one two ]"),verse("e","three four ]4]")])).toEqual([["a"],["b","c"],["d","e"]]);
  });
  it("keeps a long slot single rather than joining its second verse to the next couplet",()=>{
    expect(ids([verse("a","one two three four five six seven ]"),verse("b","one two three four five six ]"),
      verse("c","one two three four five ]"),verse("d","one two three four five ]3]")])).toEqual([["a"],["b"],["c","d"]]);
  });
  it("preserves headings and Sukhmani saloks, and uses canonical slots across pages",()=>{
    expect(ids([verse("a","one ]",{type_id:2}),verse("b","two ]",{paath_keep_single:1}),verse("c","three ]",{shabad_id:"other"})]))
      .toEqual([["a"],["b"],["c"]]);
    const pages=paathDisplayRows([{ang:179,panktis:[verse("a","one two ]",{paath_pair_id:"one:0"})]},
      {ang:180,panktis:[verse("b","three four ]1]",{source_page:180,paath_pair_id:"one:0"}),
        verse("c","five six ]",{source_page:180,paath_pair_id:"one:1"}),verse("d","seven eight ]2]",{source_page:180,paath_pair_id:"one:1"})]}]);
    expect(pages.map(p=>p.rows.map(row=>row.map(p=>p.id)))).toEqual([[["a","b"]],[["c","d"]]]);
  });
});
