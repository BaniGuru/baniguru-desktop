import { describe, expect, it } from "vitest";
import {
  findStrongOfflinePanktiMatch,
  selectOfflinePankti,
  scoreOfflinePankti,
  selectOfflineShabadFromSegments,
} from "./offlinePanktiMatch";

const candidates = [
  { id: "1", gurmukhi_speech: "ਕਵਣ ਬਾਪਾਰੀ ਜਾ ਕਾ ਊਹਾ ਵਿਸਾਹੁ" },
  { id: "2", gurmukhi_speech: "ਕਵਣ ਬਾਪਾਰੀ ਜਾ ਕਾ ਈਹਾ ਵਿਸਾਰ" },
  { id: "3", gurmukhi_speech: "ਅੰਮ੍ਰਿਤ ਨਾਮ ਪਰਮੇਸਰ ਤੇਰਾ" },
];

describe("offline pankti matching", () => {
  it("finds an exact pankti", () => {
    expect(selectOfflinePankti("ਅੰਮ੍ਰਿਤ ਨਾਮ ਪਰਮੇਸਰ ਤੇਰਾ", candidates)?.id).toBe("3");
  });
  it("accepts a useful partial pankti", () => {
    expect(selectOfflinePankti("ਅੰਮ੍ਰਿਤ ਨਾਮ ਪਰਮੇਸਰ ਤੇਰਾ", candidates)?.id).toBe("3");
  });
  it("matches a partial pankti with small ASR spelling errors", () => {
    expect(selectOfflinePankti("ਅੰਮਰਿਤ ਨਾਮ ਪਰਮੇਸਰ ਤੇਰਾ", candidates)?.id).toBe("3");
  });
  it("waits for enough words before auto-navigation", () => {
    expect(selectOfflinePankti("ਅੰਮ੍ਰਿਤ ਨਾਮ", candidates)).toBeNull();
  });
  it("rejects one-word speech", () => {
    expect(selectOfflinePankti("ਅੰਮ੍ਰਿਤ", candidates)).toBeNull();
  });
  it("does not auto-pick an ambiguous result", () => {
    expect(selectOfflinePankti("ਕਵਣ ਬਾਪਾਰੀ ਜਾ ਕਾ", candidates)).toBeNull();
  });
  it("scores punctuation-insensitively", () => {
    expect(scoreOfflinePankti("ਅੰਮ੍ਰਿਤ, ਨਾਮ", "ਅੰਮ੍ਰਿਤ ਨਾਮ")).toBe(1);
  });
  it("normalizes the ਕਿਰ... and ਕ੍ਰਿ... spelling variants", () => {
    expect(scoreOfflinePankti("ਕਿਰਪਾ ਪ੍ਰਭ", "ਕ੍ਰਿਪਾ ਪ੍ਰਭ")).toBe(1);
  });
  it("finds the expected Darbar Sahib line despite the alternate ਕਿਰਪਾ spelling", () => {
    const expected = "ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ ਦੀਨ ਦਇਆਲਾ ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ";
    const asr = "ਕਰ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ ਦੀਨ ਦਇਆਲਾ ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ";
    expect(scoreOfflinePankti(asr, expected)).toBe(1);
  });
  it("finds the Darbar Sahib line from its clear four-word tail", () => {
    const candidates = [
      { id: "darbar", gurmukhi_speech: "ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ ਦੀਨ ਦਇਆਲਾ ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ" },
      { id: "other", gurmukhi_speech: "ਤੇਰੀ ਓਟ ਕਰਿ ਪ੍ਰਭ ਦਇਆਲਾ" },
    ];
    expect(selectOfflinePankti("ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲ", candidates)?.id).toBe("darbar");
  });
  it("matches a pankti inside a longer rolling transcript window", () => {
    expect(scoreOfflinePankti(
      "ਕਵਣ ਬਾਪਾਰੀ ਜਾ ਕਾ ਊਹਾ ਵਿਸਾਹੁ ਅੰਮ੍ਰਿਤ ਨਾਮ ਪਰਮੇਸਰ ਤੇਰਾ",
      "ਅੰਮ੍ਰਿਤ ਨਾਮ ਪਰਮੇਸਰ ਤੇਰਾ",
    )).toBe(1);
  });
  it("finds the uniquely matching loaded pankti from two typo-tolerant words", () => {
    const loaded = [
      { gurmukhi_speech: "ਸਭਨਾ ਜੀਆ ਕਾ ਇਕੁ ਦਾਤਾ ਸੋ ਮੈ ਵਿਸਰਿ ਨ ਜਾਈ" },
      { gurmukhi_speech: "ਨਾਨਕ ਨਾਮ ਚੜ੍ਹਦੀ ਕਲਾ ਤੇਰੇ ਭਾਣੇ ਸਰਬੱਤ ਦਾ ਭਲਾ" },
    ];
    expect(findStrongOfflinePanktiMatch(loaded, "ਦਾਤਾ ਸੋ ਮੈ ਵਿਸਰ ਨ ਜਾਈ")?.panktiIdx).toBe(0);
  });
  it("tolerates a one-character Punjabi word error in the two-word anchor", () => {
    const loaded = [
      { gurmukhi_speech: "ਸਭਨਾ ਜੀਆ ਕਾ ਇਕੁ ਦਾਤਾ ਸੋ" },
      { gurmukhi_speech: "ਨਾਨਕ ਨਾਮ ਚੜ੍ਹਦੀ ਕਲਾ" },
    ];
    expect(findStrongOfflinePanktiMatch(loaded, "ਸਬਨਾ ਜੀਆ")?.panktiIdx).toBe(0);
  });
  it("does not choose between identical matching panktis", () => {
    const loaded = [
      { gurmukhi_speech: "ਕਰ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ" },
      { gurmukhi_speech: "ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ" },
    ];
    expect(findStrongOfflinePanktiMatch(loaded, "ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ")).toBeNull();
  });
  it("follows the latest of two distinct panktis in the rolling transcript", () => {
    const loaded = [
      { gurmukhi_speech: "ਪਹਿਲਾ ਨਾਮ ਪੰਕਤੀ" },
      { gurmukhi_speech: "ਦੂਜਾ ਸ਼ਬਦ ਪੰਕਤੀ" },
    ];
    expect(findStrongOfflinePanktiMatch(loaded, "ਪਹਿਲਾ ਨਾਮ ਫਿਰ ਦੂਜਾ ਸ਼ਬਦ")?.panktiIdx).toBe(1);
  });
  it("uses multiple Kirtan Panktis to disambiguate a repeated line across Shabads", () => {
    const candidates = [
      { id: "same-a", shabad_id: "shabad-a", order_id: 1, gurmukhi_speech: "ਕਰ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ" },
      { id: "next-a", shabad_id: "shabad-a", order_id: 2, gurmukhi_speech: "ਦੀਨ ਦਇਆਲਾ ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ" },
      { id: "same-b", shabad_id: "shabad-b", order_id: 4, gurmukhi_speech: "ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ" },
    ];
    expect(selectOfflineShabadFromSegments([
      "ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ",
      "ਦੀਨ ਦਇਆਲਾ ਤੇਰੀ ਓਟ ਪੂਰਨ ਗੋਪਾਲਾ",
    ], candidates)?.shabadId).toBe("shabad-a");
  });
  it("keeps a single repeated Pankti ambiguous between Shabads", () => {
    const candidates = [
      { id: "same-a", shabad_id: "shabad-a", gurmukhi_speech: "ਕਰ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ" },
      { id: "same-b", shabad_id: "shabad-b", gurmukhi_speech: "ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ" },
    ];
    expect(selectOfflineShabadFromSegments(["ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ"], candidates)).toBeNull();
  });
});
