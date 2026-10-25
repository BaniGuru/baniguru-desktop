import { describe, expect, it } from "vitest";
import { advanceOfflinePilotCursor } from "./offlinePilotCursor";
import { decideOfflineSearch, hasOfflineSearchEvidence, needsOfflineSearch } from "./offlineSearchDecision";

const opening = {id:"opening",shabad_id:"song",gurmukhi_speech:"ਕਰਿ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ"};
const refrain = {id:"refrain",shabad_id:"song",gurmukhi_speech:"ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ"};
const context = {shabadId:"song",baniId:null,panktis:[opening,refrain]};

describe("offline recording search decisions", () => {
  it("anchors continuous paath to the source rather than a shared anthology membership", () => {
    const row = {...opening,bani_ids:[7,8]};
    const empty = {shabadId:null,baniId:null,panktis:[]};
    const first = decideOfflineSearch(opening.gurmukhi_speech,[row],empty,false,null,340);
    expect(first.selection).toBeNull();
    expect(decideOfflineSearch(opening.gurmukhi_speech,[row],empty,false,first.pending,680).selection?.baniId).toBeNull();
  });
  it("counts fresh audio observations of a held phrase, without counting a React rerender twice", () => {
    const speech = "ਕਰਿ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ ਕਰਿ ਕਿਰਪਾ ਪ੍ਰਭ";
    const first = advanceOfflinePilotCursor({pending:null,lastTokenEnd:8},context.panktis,context.panktis,speech,1,true,null,1000);
    expect(first.currentIdx).toBe(1);
    const rerender = advanceOfflinePilotCursor(first,context.panktis,context.panktis,speech,1,true,null,1000);
    expect(rerender.currentIdx).toBe(1);
    expect(advanceOfflinePilotCursor(rerender,context.panktis,context.panktis,speech,1,true,null,1680).currentIdx).toBe(0);
    const other = {id:"other",shabad_id:"next",gurmukhi_speech:"ਮੋਹਿ ਨਿਰਗੁਨ ਸਭ ਗੁਣ"};
    const pending = decideOfflineSearch(other.gurmukhi_speech,[other],context,true,null,1000);
    expect(pending.selection).toBeNull();
    expect(decideOfflineSearch(other.gurmukhi_speech,[other],context,true,pending.pending,1000).selection).toBeNull();
    expect(decideOfflineSearch(other.gurmukhi_speech,[other],context,true,pending.pending,1680).selection?.row.id).toBe("other");
  });

  it("confirms a unique two-word repeated line over two refreshes", () => {
    const speech = "ਕਰਿ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ ਕਰਿ ਕਿਰਪਾ";
    const first = advanceOfflinePilotCursor({pending:null,lastTokenEnd:8},context.panktis,context.panktis,speech,1,true,null,1000);
    expect(first.currentIdx).toBe(1);
    expect(advanceOfflinePilotCursor(first,context.panktis,context.panktis,speech,1,true,null,1680).currentIdx).toBe(0);
    expect(advanceOfflinePilotCursor(first,context.panktis,context.panktis,speech,1,false,null,1680).currentIdx).toBe(1);
  });
  it("does not select a Shabad from a repeated greeting", () => {
    expect(hasOfflineSearchEvidence("ਵਾਹਿਗੁਰੂ ਜੀ ਵਾਹਿਗੁਰੂ ਵਾਹਿਗੁਰੂ ਜੀ")).toBe(false);
    const chant = {id:"chant",shabad_id:"other",gurmukhi_speech:"ਵਾਹਿਗੁਰੂ ਵਾਹਿਗੁਰੂ ਵਾਹਿਗੁਰੂ ਵਾਹਿ ਜੀਉ"};
    expect(decideOfflineSearch("ਵਾਹਿਗੁਰੂ ਵਾਹਿਗੁਰੂ ਵਾਹਿ ਜੀਉ ਡੰਡਉਤਿ", [chant],
      {shabadId:null,baniId:null,panktis:[]},true,null).selection).toBeNull();
  });

  it("reacquires a new Kirtan Shabad without querying while the loaded song still matches", () => {
    expect(needsOfflineSearch(opening.gurmukhi_speech,context,true)).toBe(false);
    const next = {id:"next",shabad_id:"next-song",gurmukhi_speech:"ਮੋਹਿ ਨਿਰਗੁਨ ਸਭ ਗੁਣ ਤੇਰੇ"};
    expect(needsOfflineSearch(next.gurmukhi_speech,context,true)).toBe(true);
    expect(decideOfflineSearch(next.gurmukhi_speech,[next],context,true,null).selection?.row.id).toBe("next");
    expect(needsOfflineSearch(next.gurmukhi_speech,context,false)).toBe(false);
    const asa = {...context,baniId:13};
    expect(needsOfflineSearch(opening.gurmukhi_speech,asa,true)).toBe(false);
    expect(needsOfflineSearch(next.gurmukhi_speech,asa,true)).toBe(true);
    expect(decideOfflineSearch(next.gurmukhi_speech,[next],asa,true,null).selection?.baniId).toBeNull();
  });

  it("follows a newly sung repeated line without reusing old transcript evidence", () => {
    const speech = "ਕਰਿ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ ਕਰਿ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ";
    const cursor = {pending:null,lastTokenEnd:8};
    const kirtan = advanceOfflinePilotCursor(cursor,context.panktis,context.panktis,speech,1,true,null);
    expect(kirtan.currentIdx).toBe(0);
    const paath = advanceOfflinePilotCursor(cursor,context.panktis,context.panktis,speech,1,false,null);
    expect(paath.currentIdx).toBe(1);
    const stale = advanceOfflinePilotCursor({...cursor,lastTokenEnd:20},context.panktis,context.panktis,speech,1,true,null);
    expect(stale.currentIdx).toBe(1);
  });
});

describe("paath search recovery safeguards", () => {
  const first = {...opening,order_id:100,source_page:10,source_id:1};
  const next = {id:"later",shabad_id:"later-song",gurmukhi_speech:"ਮੋਹਿ ਨਿਰਗੁਨ ਸਭ ਗੁਣ ਤੇਰੇ",order_id:120,source_page:11,source_id:1};
  const lost = {shabadId:"song",baniId:null,panktis:[first],current:0,recovering:true};
  it("allows recovery only after sequential tracking declares itself lost", () => {
    expect(needsOfflineSearch(next.gurmukhi_speech,{...lost,recovering:false},false)).toBe(false);
    expect(needsOfflineSearch(next.gurmukhi_speech,lost,false)).toBe(true);
    const a=decideOfflineSearch(next.gurmukhi_speech,[next],lost,false,null,10000);
    expect(a.selection).toBeNull();
    expect(decideOfflineSearch(next.gurmukhi_speech,[next],lost,false,a.pending,10000).selection).toBeNull();
    expect(decideOfflineSearch(next.gurmukhi_speech,[next],lost,false,a.pending,10340).selection?.row.id).toBe("later");
  });
  it("rejects distant lines, backwards matches and other sources", () => {
    for(const row of [{...next,order_id:300},{...next,order_id:99},{...next,source_id:2},{...next,source_page:50}]) {
      const a=decideOfflineSearch(row.gurmukhi_speech,[row],lost,false,null,10000);
      expect(decideOfflineSearch(row.gurmukhi_speech,[row],lost,false,a.pending,10340).selection).toBeNull();
    }
  });
  it("leaves ambiguous acquisition on Search rather than choosing a random Shabad", () => {
    const ambiguous=[next,{...next,id:"duplicate",shabad_id:"another-song"}];
    const empty={shabadId:null,baniId:null,panktis:[]};
    const a=decideOfflineSearch(next.gurmukhi_speech,ambiguous,empty,false,null,340);
    expect(decideOfflineSearch(next.gurmukhi_speech,ambiguous,empty,false,a.pending,680).selection).toBeNull();
  });
});
