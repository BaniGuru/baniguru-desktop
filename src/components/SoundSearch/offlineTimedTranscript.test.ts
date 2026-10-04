import { describe, expect, it } from "vitest";
import { mergeOfflineTimedWords } from "./offlineTimedTranscript";

describe("offline timed transcript window merging", () => {
  it("keeps earlier words and deduplicates the overlap", () => {
    const first = [
      { word: "ਕਰ", start_ms: 100, end_ms: 260 },
      { word: "ਕਿਰਪਾ", start_ms: 280, end_ms: 540 },
    ];
    const next = [
      { word: "ਕਿਰਪਾ", start_ms: 300, end_ms: 560 },
      { word: "ਪ੍ਰਭ", start_ms: 600, end_ms: 820 },
    ];

    expect(mergeOfflineTimedWords(first, next).map(word => word.word)).toEqual([
      "ਕਰ", "ਕਿਰਪਾ", "ਪ੍ਰਭ",
    ]);
  });

  it("replaces a corrected spelling when the word timing shifts by 123 ms", () => {
    const first = [{ word: "ਕਿਰਪਾ", start_ms: 716, end_ms: 1_393 }];
    const corrected = [{ word: "ਕ੍ਰਿਪਾ", start_ms: 839, end_ms: 1_436 }];

    expect(mergeOfflineTimedWords(first, corrected)).toEqual(corrected);
  });

  it("replaces a stale word with a bloated alignment span", () => {
    const stale = [{ word: "ਲਾਟ", start_ms: 5_639, end_ms: 9_818 }];
    const corrected = [{ word: "ਤੇਰੀ", start_ms: 8_151, end_ms: 8_987 }];

    expect(mergeOfflineTimedWords(stale, corrected)).toEqual(corrected);
  });

  it("keeps repeated words when they occur at different audio times", () => {
    const repeated = [
      { word: "ਹਰਿ", start_ms: 100, end_ms: 220 },
      { word: "ਹਰਿ", start_ms: 900, end_ms: 1_020 },
    ];

    expect(mergeOfflineTimedWords([], repeated)).toHaveLength(2);
  });

  it("keeps quick repeated words instead of merging them as window duplicates", () => {
    const repeated = [
      { word: "ਹਰਿ", start_ms: 100, end_ms: 240 },
      { word: "ਹਰਿ", start_ms: 460, end_ms: 610 },
    ];

    expect(mergeOfflineTimedWords([], repeated)).toEqual(repeated);
  });

  it("still merges the same word when only its rolling-window timing shifts slightly", () => {
    const prior = [{ word: "ਹਰਿ", start_ms: 100, end_ms: 260 }];
    const next = [{ word: "ਹਰਿ", start_ms: 220, end_ms: 390 }];

    expect(mergeOfflineTimedWords(prior, next)).toEqual(next);
  });
});
