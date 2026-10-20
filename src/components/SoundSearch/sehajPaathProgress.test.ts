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
