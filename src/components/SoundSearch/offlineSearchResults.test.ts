import {describe,it,expect} from "vitest";
import {stabilizeOfflineSearchResults} from "./offlineSearchResults";
const a={id:"a",shabad_id:"one"},b={id:"b",shabad_id:"two"},c={id:"c",shabad_id:"three"};
describe("readable offline search choices",()=>{
 it("holds choices for two seconds, then confirms a different leader on distinct audio",()=>{
  const initial=stabilizeOfflineSearchResults({rows:[],publishedAt:0},[a,b],340);
  const held=stabilizeOfflineSearchResults(initial,[c,b],1680);
  expect(held.rows).toBe(initial.rows);
  expect(held.refreshAfter).toBe(2340);
  const challenge=stabilizeOfflineSearchResults(initial,[c,b],2380);
  expect(challenge.rows).toBe(initial.rows);
  expect(stabilizeOfflineSearchResults(challenge,[c,b],2380).rows).toBe(initial.rows);
  const accepted=stabilizeOfflineSearchResults(challenge,[c,b],2720);
  expect(accepted.rows).toEqual([b,c]);
 });
 it("does not shuffle still-relevant choices for ASR score changes",()=>{
  const state={rows:[a,b],publishedAt:0};
  const challenge=stabilizeOfflineSearchResults(state,[b,a],2500);
  expect(stabilizeOfflineSearchResults(challenge,[b,a],2840).rows).toEqual([a,b]);
  expect(stabilizeOfflineSearchResults(state,[],5000)).toBe(state);
 });
});
