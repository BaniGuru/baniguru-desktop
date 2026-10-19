/// <reference types="node" />
import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { gurbaniSearch } from "../../utils/gurbaniSearch";
import {
  buildOfflineSearchQueries, buildOfflineShabadMatchSequence, normalizeOfflineText,
} from "./offlinePanktiMatch";
import { advanceOfflinePilotCursor, OfflinePilotCursor } from "./offlinePilotCursor";
import { decideOfflineSearch, needsOfflineSearch, PendingOfflineSearch } from "./offlineSearchDecision";

const database = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("../../utils/DB", () => ({ DB: {
  getDbPath: () => process.env.BANI_TEST_DB,
  getInstance: async () => ({ select: async () => database.rows }),
} }));

describe.skipIf(!process.env.BANI_RECORDING_REPLAY)("timestamped recording Auto Pilot replay", () => {
  let shabads: Map<string, any[]>;
  let successor: Map<string, string>;
  let banis: Map<number, any[]>;
  let byId: Map<string, any>;
  const trigrams = new Map<string, Set<string>>();

  beforeAll(async () => {
    const data = JSON.parse(execFileSync("python3", ["-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row
rows=[dict(r) for r in c.execute('SELECT p.id,p.gurmukhi_speech,p.source_id,l.shabad_id,l.order_id FROM panktis p JOIN lines l ON l.id=p.id ORDER BY l.order_id')]
members={};banis={}
for r in c.execute('SELECT b.line_id,b.bani_id FROM bani_lines b JOIN lines l ON l.id=b.line_id ORDER BY b.bani_id,b.line_group,l.order_id'):
 members.setdefault(r['line_id'],[]).append(r['bani_id']);banis.setdefault(r['bani_id'],[]).append(r['line_id'])
for r in rows:r['bani_ids']=members.get(r['id'],[])
sources={}
for r in c.execute('SELECT id,source_id FROM shabads ORDER BY source_id,order_id'):sources.setdefault(r['source_id'],[]).append(r['id'])
nexts={a:b for ids in sources.values() for a,b in zip(ids,ids[1:])}
print(json.dumps(dict(rows=rows,banis=banis,successor=nexts),ensure_ascii=False))
`, process.env.BANI_TEST_DB!], { maxBuffer: 100 * 1024 * 1024 }).toString());
    database.rows = data.rows;
    byId = new Map(data.rows.map((row: any) => [row.id, row]));
    shabads = new Map();
    for (const row of data.rows) {
      const lines = shabads.get(row.shabad_id) ?? [];
      lines.push(row); shabads.set(row.shabad_id, lines);
      const words = normalizeOfflineText(row.gurmukhi_speech).split(" ");
      for (let i = 0; i + 2 < words.length; i++) {
        const key = words.slice(i, i + 3).join(" ");
        const ids = trigrams.get(key) ?? new Set<string>();
        ids.add(row.id); trigrams.set(key, ids);
      }
    }
    successor = new Map(Object.entries(data.successor));
    banis = new Map(Object.entries(data.banis).map(([id, ids]) => [Number(id), (ids as string[]).map(id => byId.get(id))]));
    await gurbaniSearch.init();
  }, 60_000);

  function expectedIds(section: any): Set<string> {
    if (section.line_id) return new Set([section.line_id]);
    const words = normalizeOfflineText(section.transcript).split(" ");
    const counts = new Map<string, number>();
    for (let i = 0; i + 2 < words.length; i++) {
      for (const id of trigrams.get(words.slice(i, i + 3).join(" ")) ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const maximum = Math.max(0, ...counts.values());
    const ids = [...counts].filter(([, count]) => count >= Math.max(1, maximum - 1)).map(([id]) => id);
    return new Set(ids.length <= 20 ? ids : []);
  }

  it("measures complete recording search and Pankti progression", async () => {
    const input = JSON.parse(readFileSync(process.env.BANI_RECORDING_REPLAY!, "utf8"));
    const control = Array.isArray(input);
    const clips = control ? input : input.clips;
    const results = [];
    for (const clip of clips) {
      const kirtan = control ? clip.kirtan : clip.profile === "kirtan";
      const sections = control ? clip.sections : clip.reference_sections;
      expect(sections.length).toBeGreaterThan(0);
      const expected = sections.map(expectedIds);
      const events = control ? sections.flatMap((s: any) => {
        const words = s.transcript.split(/\s+/);
        return words.map((word: string, index: number) => ({ end_ms: Math.round(1_000 * (s.start_time + (s.end_time - s.start_time) * (index + 1) / words.length)), final_words: [{word}], partial_words: [] }));
      }) : clip.events;
      let committed: string[] = [];
      let current = 0;
      let loaded: any[] = [];
      let shabadId: string | null = null;
      let baniId: number | null = null;
      let cursor: OfflinePilotCursor = { pending: null, lastTokenEnd: -1 };
      let lastSearch = "";
      let lastVisible = "";
      let pendingSearch: PendingOfflineSearch = null;
      let cachedRows: any[] = [];
      let searchCount = 0;
      let foundAt: number | null = null;
      const transitions: any[] = [];
      const firstSeen = sections.map(() => null as number | null);
      const shabadSelections = new Set<string>();
      let progressAt = 300_000;
      for (const event of events) {
        if (event.end_ms >= progressAt) {
          process.stdout.write(`REPLAY_PROGRESS ${JSON.stringify({id:clip.id,audio_seconds:event.end_ms/1000,searches:searchCount,transitions:transitions.length})}\n`);
          progressAt += 300_000;
        }
        committed.push(...event.final_words.map((w: any) => w.word));
        const speech = [...committed, ...event.partial_words.map((w: any) => w.word)].join(" ");
        const changed = speech !== lastVisible;
        lastVisible = speech;
        const recent = speech.split(/\s+/).slice(-32).join(" ");
        const context = {shabadId, baniId, panktis:loaded};
        let selectedNew = false;
        if ((changed || pendingSearch) && needsOfflineSearch(recent, context, kirtan)) {
          if ((recent !== lastSearch || pendingSearch) && recent.split(" ").length >= 4) {
            if (recent !== lastSearch) {
              lastSearch = recent; searchCount++;
              const candidates = await gurbaniSearch.search(buildOfflineSearchQueries(recent), "search");
              cachedRows = candidates.slice(0, 120).map(row => byId.get(row.id));
            }
            const decision = decideOfflineSearch(recent, cachedRows, context, kirtan, pendingSearch, event.end_ms);
            pendingSearch = decision.pending;
            const row = decision.selection?.row;
            if (row) {
              baniId = decision.selection!.baniId;
              shabadId = row.shabad_id;
              loaded = baniId ? banis.get(baniId)! : shabads.get(shabadId!)!;
              current = loaded.findIndex(line => line.id === row.id);
              foundAt ??= event.end_ms / 1_000;
              selectedNew = true;
              cursor.pending = null;
              shabadSelections.add(shabadId!);
              transitions.push({ at: event.end_ms / 1_000, id: row.id, shabadId, baniId, reason: "search" });
            }
          }
        } else if (changed || pendingSearch) { pendingSearch = null; }
        if (loaded.length && !selectedNew) {
          const nextId: string | null = !kirtan && baniId == null ? successor.get(shabadId!) ?? null : null;
          const nextLines = nextId ? shabads.get(nextId)! : [];
          const sequence = nextLines.length ? buildOfflineShabadMatchSequence(loaded, nextLines,
            !kirtan && current >= loaded.length - 2) : { panktis: loaded, skippedNextPanktis: 0 };
          const next = advanceOfflinePilotCursor(cursor, sequence.panktis, loaded, speech, current, kirtan, baniId, event.end_ms);
          cursor = next;
          if (next.currentIdx !== current) {
            current = next.currentIdx;
            if (current >= loaded.length && nextId) {
              current = current - loaded.length + sequence.skippedNextPanktis;
              loaded = nextLines; shabadId = nextId;
              shabadSelections.add(nextId);
            }
            transitions.push({ at: event.end_ms / 1_000, id: loaded[current]?.id, shabadId, baniId, reason: "pankti" });
          }
        }
        const id = loaded[current]?.id;
        if (id) sections.forEach((section: any, index: number) => {
          if (firstSeen[index] == null && expected[index].has(id) &&
            event.end_ms / 1_000 >= section.start_time - 1 && event.end_ms / 1_000 <= section.end_time + 2) {
            firstSeen[index] = event.end_ms / 1_000;
          }
        });
      }
      const eligible = expected.filter((ids: Set<string>) => ids.size > 0).length;
      const matched = firstSeen.filter((at: number | null) => at != null).length;
      const result = { id: clip.id, kind: control ? "manual_text_control" : "ASR_events", kirtan,
        expected_label_source: kirtan ? "candidate database lines sharing manual-reference trigrams; approximate" : "manual JSON line_id",
        sections: sections.length, eligible, matched, coverage: eligible ? matched / eligible : null,
        found_at_seconds: foundAt, search_count: searchCount, shabads_selected: [...shabadSelections], transitions,
        section_results: sections.map((s: any, i: number) => ({section_id:s.section_id, expected_ids:[...expected[i]], first_seen:firstSeen[i], start:s.start_time,end:s.end_time,transcript:s.transcript})),
      };
      console.log("REPLAY_RESULT", JSON.stringify({...result, transitions:undefined,section_results:undefined}));
      expect(transitions.length).toBeGreaterThan(0);
      if (clip.id === "sehaj-ang16") {
        expect(matched).toBe(sections.length);
        const order = transitions.map(row => byId.get(row.id).order_id);
        expect(order).toEqual([...order].sort((a,b) => a-b));
      }
      if (clip.id === "agyakar-kirtan") {
        expect(shabadSelections.size).toBeGreaterThanOrEqual(3);
        expect(transitions.some((row, index) => index > 0 &&
          row.shabadId === transitions[index-1].shabadId &&
          byId.get(row.id).order_id < byId.get(transitions[index-1].id).order_id)).toBe(true);
        expect(firstSeen.some((time: number | null, index: number) =>
          time != null && sections[index].start_time > sections.at(-1).end_time * 0.75)).toBe(true);
      }
      results.push(result);
    }
    if (process.env.BANI_RECORDING_REPLAY_OUTPUT) writeFileSync(process.env.BANI_RECORDING_REPLAY_OUTPUT, JSON.stringify(results, null, 2) + "\n");
  }, 1_800_000);
});
