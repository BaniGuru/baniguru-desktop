import { describe, expect, it } from "vitest";
import { advanceOfflinePilotCursor } from "./offlinePilotCursor";
import { findOfflinePanktiProgress } from "./offlinePanktiMatch";

const panktis = [
  "ਕਰਿ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ",
  "ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ",
  "ਗੁਰਮੁਖਿ ਨਾਮੁ ਧਿਆਈਐ ਮਨ ਮੰਦਰੁ ਭੀਜੈ ਰਹਾਉ",
  "ਕੂੜਾ ਲਾਲਚੁ ਛੋਡੀਐ ਤਉ ਸਾਚੁ ਪਛਾਣੈ",
  "ਜਿਨੀ ਨਾਮੁ ਵਿਸਾਰਿਆ ਦੂਜੈ ਭਰਮਿ ਭੁਲਾਈ",
  "ਮੂਲੁ ਛੋਡਿ ਡਾਲੀ ਲਗੇ ਕਿਆ ਪਾਵਹਿ ਛਾਈ",
  "ਗੁਰਮੁਖਿ ਹੋਇ ਤ ਛੂਟੀਐ ਮਨਮੁਖਿ ਪਤਿ ਖੋਈ",
  "ਜਿਨੀ ਏਕੋ ਸੇਵਿਆ ਪੂਰੀ ਮਤਿ ਭਾਈ",
].map(gurmukhi_speech => ({gurmukhi_speech}));

describe("sehaj paath nearby progression", () => {
  it("cannot jump far ahead even on an exact distant phrase in a loaded Bani", () => {
    const transcript = `ਸ਼ੋਰ ਗਲਤ ਸ਼ਬਦ ${panktis[7].gurmukhi_speech}`;
    const next = advanceOfflinePilotCursor({pending:null,lastTokenEnd:-1},panktis,panktis,transcript,0,false,12,340);
    expect(next.currentIdx).toBe(0);
    expect(findOfflinePanktiProgress(panktis,transcript,0,false,12)).toBeNull();
  });
  it("can skip a nearby missed line with fresh strong words", () => {
    const transcript = `ਸ਼ੋਰ ${panktis[2].gurmukhi_speech.split(" ").slice(0,3).join(" ")}`;
    expect(advanceOfflinePilotCursor({pending:null,lastTokenEnd:-1},panktis,panktis,transcript,0,false,null,340).currentIdx).toBe(2);
  });
  it("recovers a one-line overshoot after two observations of newly spoken words", () => {
    const transcript = "ਸ਼ੋਰ ਤੇਰੀ ਓਟ ਪੂਰਨ";
    const first = advanceOfflinePilotCursor({pending:null,lastTokenEnd:0},panktis,panktis,transcript,2,false,null,340);
    expect(first.currentIdx).toBe(2);
    expect(advanceOfflinePilotCursor(first,panktis,panktis,transcript,2,false,null,340).currentIdx).toBe(2);
    expect(advanceOfflinePilotCursor(first,panktis,panktis,transcript,2,false,null,680).currentIdx).toBe(1);
    expect(advanceOfflinePilotCursor({...first,lastTokenEnd:10},panktis,panktis,transcript,2,false,null,680).currentIdx).toBe(2);
  });
  it("does not recover backwards on only two repeated or noisy words", () => {
    expect(findOfflinePanktiProgress(panktis,"ਤੇਰੀ ਓਟ",2,false,null)).toBeNull();
  });
  it("does not let older forward words conceal fresh nearby recovery evidence", () => {
    const speech = "ਕੂੜਾ ਲਾਲਚੁ ਛੋਡੀਐ ਤੇਰੀ ਓਟ ਪੂਰਨ";
    const first = advanceOfflinePilotCursor({pending:null,lastTokenEnd:2},panktis,panktis,speech,2,false,null,340);
    expect(first.currentIdx).toBe(2);
    expect(advanceOfflinePilotCursor(first,panktis,panktis,speech,2,false,null,680).currentIdx).toBe(1);
  });
});

describe("paath recovery after noisy skipped lines", () => {
  it("opens only a bounded forward corridor after a stall and confirms on new audio", () => {
    const speech = panktis[7].gurmukhi_speech;
    const stalled = {pending:null,lastTokenEnd:-1,lastEvidenceMs:1000,lastEvidenceTokenEnd:-1};
    const first = advanceOfflinePilotCursor(stalled,panktis,panktis,speech,0,false,null,5340);
    expect(first.currentIdx).toBe(0);
    expect(first.recovery?.panktiIdx).toBe(7);
    expect(advanceOfflinePilotCursor(first,panktis,panktis,speech,0,false,null,5340).currentIdx).toBe(0);
    expect(advanceOfflinePilotCursor(first,panktis,panktis,speech,0,false,null,5680).currentIdx).toBe(7);
  });
  it("never widens backwards or reuses old supported text during silence", () => {
    const stalled = {pending:null,lastTokenEnd:10,lastEvidenceMs:1000,lastEvidenceTokenEnd:10};
    expect(advanceOfflinePilotCursor(stalled,panktis,panktis,panktis[7].gurmukhi_speech,0,false,null,9000).currentIdx).toBe(0);
    expect(advanceOfflinePilotCursor(stalled,panktis,panktis,panktis[0].gurmukhi_speech,7,false,null,9000).currentIdx).toBe(7);
  });
});

it("recovers the uploaded Oct 25 recording's stalled ਭੈ ਸਾਗਰ passage",()=>{
  const source=[
    "ਜਿਉ ਬੋਹਿਥੁ ਭੈ ਸਾਗਰ ਮਾਹਿ", "ਅੰਧਕਾਰ ਦੀਪਕ ਦੀਪਾਹਿ", "ਅਗਨਿ ਸੀਤ ਕਾ ਲਾਹਸਿ ਦੂਖ",
    "ਨਾਮੁ ਜਪਤ ਮਨਿ ਹੋਵਤ ਸੂਖ", "ਉਤਰਿ ਜਾਇ ਤੇਰੇ ਮਨ ਕੀ ਪਿਆਸ", "ਪੂਰਨ ਹੋਵੈ ਸਗਲੀ ਆਸ",
  ].map(gurmukhi_speech=>({gurmukhi_speech}));
  // Actual noisy words from the recording; several intervening lines fail.
  const speech="ਜਿਉ ਬੋਇ ਪਹਿ ਸਾਗਰ ਮਾਹਿ ਅੰਧ ਕਾਢਿ ਦੀ ਭੁਗਤੀ ਪਾਹਿ ਅਗਨਿ ਛੇਦਕਾ ਲਾਹ ਦੂਖ ਨਾਹ ਜਉ ਮਰਿ ਹੋਵਤ ਸੂਖ ਉਤਰਿ ਜੈ ਤੇ ਮਨ ਕੀ ਪਿਆਸ";
  const first=advanceOfflinePilotCursor({pending:null,lastTokenEnd:5,lastEvidenceTokenEnd:5,lastEvidenceMs:26000},source,source,speech,0,false,null,35000);
  expect(first.currentIdx).toBe(0);
  expect(advanceOfflinePilotCursor(first,source,source,speech,0,false,null,35340).currentIdx).toBe(4);
});

it("weak common words do not postpone reacquiring a different ang forever",()=>{
 const lines=[{gurmukhi_speech:'ਹਰਿ ਨਾਮੁ ਅੰਮ੍ਰਿਤੁ ਮਨਿ ਵਸਾਵਹੁ'}];
 const cursor={pending:null,lastTokenEnd:-1,lastEvidenceMs:1000,lastEvidenceTokenEnd:0,lastStrongEvidenceMs:1000,lastStrongTokenEnd:0};
 const weak=advanceOfflinePilotCursor(cursor,lines,lines,'ਗਲਤ ਸ਼ਬਦ ਹਰਿ ਨਾਮੁ',0,false,null,13000);
 expect(weak.lastEvidenceMs).toBe(13000);
 expect(weak.lastStrongEvidenceMs).toBe(1000);
 const strong=advanceOfflinePilotCursor(weak,lines,lines,'ਗਲਤ ਸ਼ਬਦ ਹਰਿ ਨਾਮੁ ਅੰਮ੍ਰਿਤੁ ਮਨਿ',0,false,null,13340);
 expect(strong.lastStrongEvidenceMs).toBe(13340);
});
