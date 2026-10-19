/// <reference types="node" />
import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { gurbaniSearch } from "../../utils/gurbaniSearch";
import { buildOfflineSearchSegments, buildOfflineSearchQueries, findOfflinePanktiProgress, selectOfflineBaniFromSegments, selectOfflineShabadFromSegments, stabilizeOfflinePanktiMatch } from "./offlinePanktiMatch";
import { decideOfflineSearch } from "./offlineSearchDecision";

const fixture = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("../../utils/DB", () => ({ DB: {
  getDbPath: () => process.env.BANI_TEST_DB,
  getInstance: async () => ({ select: async () => fixture.rows }),
} }));

// Opt in with the real application database. No microphone or Tauri WebView
// is required; Fuse and the production matching decisions run unchanged.
describe.skipIf(!process.env.BANI_TEST_DB)("offline matching with the complete Gurbani corpus", () => {
  let asa: any[];
  let sehaj: any[];
  beforeAll(async () => {
    const output = execFileSync("python3", ["-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row
rows=[dict(r) for r in c.execute('SELECT p.id,p.gurmukhi_speech,l.shabad_id,l.order_id FROM panktis p JOIN lines l ON l.id=p.id')]
members={}
for line,bani in c.execute('SELECT line_id,bani_id FROM bani_lines'):
 members.setdefault(line,[]).append(bani)
for r in rows:r['bani_ids']=members.get(r['id'],[])
asa=[dict(r) for r in c.execute('SELECT p.id,p.gurmukhi_speech,l.shabad_id,l.order_id FROM bani_lines b JOIN lines l ON l.id=b.line_id JOIN panktis p ON p.id=l.id WHERE b.bani_id=13 ORDER BY b.line_group,l.order_id')]
sehaj=[dict(r) for r in c.execute('SELECT p.id,p.gurmukhi_speech,l.shabad_id,l.order_id FROM lines l JOIN panktis p ON p.id=l.id WHERE p.source_id=1 AND l.source_page=25 ORDER BY l.order_id')]
print(json.dumps(dict(rows=rows,asa=asa,sehaj=sehaj),ensure_ascii=False))
`, process.env.BANI_TEST_DB!], { maxBuffer: 100 * 1024 * 1024 }).toString();
    const data = JSON.parse(output);
    fixture.rows = data.rows;
    asa = data.asa;
    sehaj = data.sehaj;
    await gurbaniSearch.init();
  }, 30_000);

  it("finds Asa Ki Vaar Bani through the full search index", async () => {
    const lines = ["ਬਲਿਹਾਰੀ ਗੁਰ", "ਜੇ ਸਉ ਚੰਦਾ", "ਆਪੀਨੈ੍ ਆਪੁ"].map(prefix =>
      asa.find(row => row.gurmukhi_speech.startsWith(prefix)),
    );
    expect(lines.every(Boolean)).toBe(true);
    const speech = lines.map(row => row.gurmukhi_speech).join(" ");
    const segments = buildOfflineSearchSegments(speech);
    const results = await gurbaniSearch.search(buildOfflineSearchQueries(speech), "search");
    const loaded = results.slice(0, 120).map(row => fixture.rows.find(item => item.id === row.id));
    expect(selectOfflineBaniFromSegments(segments, loaded)?.baniId).toBe(13);
    expect(decideOfflineSearch(speech, loaded, {shabadId:null,baniId:null,panktis:[]}, true, null)
      .selection?.baniId).toBe(13);
  }, 30_000);

  it("advances Asa Ki Vaar on completion while ordinary kirtan waits", () => {
    const first = asa.findIndex(row => row.gurmukhi_speech.startsWith("ਬਲਿਹਾਰੀ ਗੁਰ"));
    const speech = asa[first].gurmukhi_speech;
    expect(findOfflinePanktiProgress(asa, speech, first, true, 13)?.panktiIdx).toBe(first + 1);
    expect(findOfflinePanktiProgress(asa, speech, first, true, null)?.panktiIdx).toBe(first);
  });

  it("finds the Darbar Sahib Shabad despite its shared opening line", async () => {
    const lines = fixture.rows.filter(row => row.shabad_id === "BMK");
    const opening = lines.find(row => row.gurmukhi_speech.startsWith("ਕਰਿ ਕਿਰਪਾ"));
    const refrain = lines.find(row => row.gurmukhi_speech.startsWith("ਤੇਰੀ ਓਟ"));
    const speech = `${opening.gurmukhi_speech} ${refrain.gurmukhi_speech}`;
    const results = await gurbaniSearch.search(buildOfflineSearchQueries(speech), "search");
    const loaded = results.slice(0, 120).map(row => fixture.rows.find(item => item.id === row.id));
    expect(selectOfflineShabadFromSegments([opening.gurmukhi_speech, refrain.gurmukhi_speech], loaded)?.shabadId).toBe("BMK");
  }, 30_000);

  it("keeps advancing sehaj paath beyond 40 spoken words and across Shabads", () => {
    expect(sehaj.length).toBeGreaterThan(10);
    let current = 0;
    let pending = null as ReturnType<typeof stabilizeOfflinePanktiMatch>["pending"];
    let lastEnd = -1;
    let transcript = "";
    const visited = new Set<number>();
    for (const row of sehaj) {
      for (const word of row.gurmukhi_speech.split(/\s+/)) {
        transcript = `${transcript} ${word}`.trim();
        const match = findOfflinePanktiProgress(sehaj, transcript, current, false, null);
        if (match && match.panktiIdx > current && match.tokenEndIndex <= lastEnd) continue;
        const next = stabilizeOfflinePanktiMatch(current, match, pending, 3);
        pending = next.pending;
        if (next.currentIdx !== current) { current = next.currentIdx; lastEnd = match!.tokenEndIndex; visited.add(current); }
      }
    }
    expect(transcript.split(/\s+/).length).toBeGreaterThan(100);
    expect(current).toBeGreaterThanOrEqual(sehaj.length - 2);
    expect(visited.size).toBeGreaterThan(sehaj.length / 2);
    expect(new Set([...visited].map(index => sehaj[index].shabad_id)).size).toBeGreaterThan(1);
  });
});
