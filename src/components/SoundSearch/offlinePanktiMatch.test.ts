import { describe, expect, it } from "vitest";
import {
  buildOfflineShabadMatchSequence,
  findStrongOfflinePanktiMatch,
  findCompletedOfflinePankti,
  selectOfflinePankti,
  scoreOfflinePankti,
  selectOfflineShabadFromSegments,
  buildOfflineSearchSegments,
  stabilizeOfflinePanktiMatch,
} from "./offlinePanktiMatch";

const candidates = [
  { id: "1", gurmukhi_speech: "ਕਵਣ ਬਾਪਾਰੀ ਜਾ ਕਾ ਊਹਾ ਵਿਸਾਹੁ" },
  { id: "2", gurmukhi_speech: "ਕਵਣ ਬਾਪਾਰੀ ਜਾ ਕਾ ਈਹਾ ਵਿਸਾਰ" },
  { id: "3", gurmukhi_speech: "ਅੰਮ੍ਰਿਤ ਨਾਮ ਪਰਮੇਸਰ ਤੇਰਾ" },
];

describe("offline pankti matching", () => {
  it("does not switch between adjacent Aasa Shabads on their shared header", () => {
    const npA = [
      "ਆਸਾ ਮਹਲਾ ਪਹਿਲਾ",
      "ਮਨਸਾ ਮਨਹਿ ਸਮਾਇਲੇ ਭਉਜਲੁ ਸਚਿ ਤਰਣਾ",
      "ਆਦਿ ਜੁਗਾਦਿ ਦਇਆਲੁ ਤੂ ਠਾਕੁਰ ਤੇਰੀ ਸਰਣਾ",
      "ਤੂ ਦਾਤੌ ਹਮ ਜਾਚਿਕਾ ਹਰਿ ਦਰਸਨੁ ਦੀਜੈ",
      "ਗੁਰਮੁਖਿ ਨਾਮੁ ਧਿਆਈਐ ਮਨ ਮੰਦਰੁ ਭੀਜੈ ਰਹਾਉ",
      "ਕੂੜਾ ਲਾਲਚੁ ਛੋਡੀਐ ਤਉ ਸਾਚੁ ਪਛਾਣੈ",
    ].map(gurmukhi_speech => ({ gurmukhi_speech }));
    const next4bl = [
      "ਆਸਾ ਮਹਲਾ ਪਹਿਲਾ",
      "ਚਲੇ ਚਲਣਹਾਰ ਵਾਟ ਵਟਾਇਆ",
      "ਧੰਧੁ ਪਿਟੇ ਸੰਸਾਰੁ ਸਚੁ ਨ ਭਾਇਆ",
    ].map(gurmukhi_speech => ({ gurmukhi_speech }));
    const sequence = buildOfflineShabadMatchSequence(npA, next4bl);

    expect(sequence.skippedNextPanktis).toBe(1);
    const repeatedNpaHeader = findStrongOfflinePanktiMatch(
      sequence.panktis,
      "ਆਸਾ ਮਹਲਾ ਪਹਿਲਾ ਮਨਸਾ ਮਨਾ ਸਮਾਲੇ ਭਵਜਲ ਸਾਚ",
      2,
      0,
    );
    expect(repeatedNpaHeader?.panktiIdx).toBe(1);
    expect(repeatedNpaHeader?.panktiIdx).toBeLessThan(npA.length);

    const actualNextShabad = findStrongOfflinePanktiMatch(
      sequence.panktis,
      "ਆਸਾ ਮਹਲਾ ਪਹਿਲਾ ਚਲੇ ਚਲਣਹਾਰ ਵਾਟ ਵਟਾਇਆ",
      2,
      0,
    );
    expect(actualNextShabad?.panktiIdx).toBe(npA.length);
  });

  it("matches the next canonical Shabad in the full fast paath recording", () => {
    // These adjacent Shabads and this live transcript are from bani.db and the
    // complete replacement test_audios/fast_akhand_paath.mp3 fixture.
    const adjacentPanktis = [
      { gurmukhi_speech: "ਜੇ ਮਨੁ ਸਤਿਗੁਰ ਦੇ ਮਿਲੈ ਕਿਨਿ ਕੀਮਤਿ ਪਾਈ" },
      { gurmukhi_speech: "ਰਤਨਾ ਪਾਰਖੁ ਸੋ ਧਣੀ ਤਿਨਿ ਕੀਮਤਿ ਪਾਈ" },
      { gurmukhi_speech: "ਨਾਨਕ ਸਾਹਿਬੁ ਮਨਿ ਵਸੈ ਸਚੀ ਵਡਿਆਈ" },
      { gurmukhi_speech: "ਆਸਾ ਮਹਲਾ ਪਹਿਲਾ" },
      { gurmukhi_speech: "ਜਿਨੀ ਨਾਮੁ ਵਿਸਾਰਿਆ ਦੂਜੈ ਭਰਮਿ ਭੁਲਾਈ" },
      { gurmukhi_speech: "ਮੂਲੁ ਛੋਡਿ ਡਾਲੀ ਲਗੇ ਕਿਆ ਪਾਵਹਿ ਛਾਈ" },
      { gurmukhi_speech: "ਬਿਨੁ ਨਾਵੈ ਕਿਉ ਛੂਟੀਐ ਜੇ ਜਾਣੈ ਕੋਈ" },
      { gurmukhi_speech: "ਗੁਰਮੁਖਿ ਹੋਇ ਤ ਛੂਟੀਐ ਮਨਮੁਖਿ ਪਤਿ ਖੋਈ" },
      { gurmukhi_speech: "ਜਿਨੀ ਏਕੋ ਸੇਵਿਆ ਪੂਰੀ ਮਤਿ ਭਾਈ" },
    ];
    const fullLiveTranscript = "ਦੇਖਾ ਸੋਇ ਗੁਰ ਕੀ ਕਾਰ ਕਮਾਇ ਰਹਾਉ ਆਪ ਰਜਾਇ ਅੰਕ ਸਮਾਵਈ ਸਚਾ ਮਨ ਸੋਈ ਆਪੇ ਦੇ ਤੋਟ ਨ ਤਬੇ ਕੀ ਚਾਕਰੀ ਹਰ ਕੀ ਬੇੜੀ ਜੇ ਭਰਮ ਗੁਰਮੁਖ ਵਸਤ ਕਰ ਪਾਇ ਜੰਮਣ ਮਰਣਾ ਆਖੀਐ ਰਹੇ ਫਿਰ ਕਾਰ ਕਮਾਵਣੀ ਧੁਰ ਕੀ ਫੁਰਮਾਈ ਜੀ ਮਨ ਮੇਰਾ ਸਤਿਗੁਰ ਦੇਇ ਮਿਲਾਇ ਤਨ ਕੀ ਮਿਤ ਧਣੀ ਤਨ ਕੀਮਤ ਨਾਨਕ ਸਾਹਿਬ ਮਨ ਵਸੈ ਸਚੀ ਵਡਿਆਈ ਆਸਾ ਮਹਲਾ ਪਹਿਲਾ ਜਿਨੀ ਨਾਮ ਵਿਸਾਰਿਆ ਲਗੇ ਕਿਆ ਭਾਵਾ ਛੂਟੀਐ ਜਾਣਾ ਕੋਈ ਗੁਰਮੁਖ ਹੋਇ ਤ ਛੂਟੀਐ ਏਕੋ ਸੇਵਿਆ ਪਸੇਵਿਆ ਪੂਰੀ ਮਤ ਭਾਈ";
    const nextMatch = findStrongOfflinePanktiMatch(
      adjacentPanktis,
      fullLiveTranscript,
      2,
      2,
    );
    expect(nextMatch?.panktiIdx).toBe(8);
    expect(stabilizeOfflinePanktiMatch(2, nextMatch, null, 3).currentIdx).toBe(8);
  });

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
  it("uses recent forward evidence when a noisy live-edge word matches the current line", () => {
    const loaded = [
      { gurmukhi_speech: "ਪਹਿਲੀ ਪੰਕਤੀ ਦਾ ਆਖਰੀ ਕਲਿ" },
      { gurmukhi_speech: "ਕਲਿ ਕਲੇਸ ਤਨ ਮਾਹਿ ਮਿਟਾਵਉ" },
      { gurmukhi_speech: "ਨਾਮੁ ਜਪਤ ਅਗਨਤ ਅਨੇਕੈ" },
    ];
    const match = findStrongOfflinePanktiMatch(
      loaded,
      "ਨਾਮੁ ਜਪਤ ਅਗਨਤ ਕਲਿ",
      2,
      1,
    );
    expect(match?.panktiIdx).toBe(2);
    expect(match?.matchedWords).toBe(3);
    expect(stabilizeOfflinePanktiMatch(1, match, null, 3).currentIdx).toBe(2);
  });
  it("accepts one exact unique word only at the live edge and waits for confirmation", () => {
    const loaded = [
      { gurmukhi_speech: "ਸਿਮਰਉ ਸਿਮਰਿ ਸਿਮਰਿ ਸੁਖੁ ਪਾਵਉ" },
      { gurmukhi_speech: "ਕਲਿ ਕਲੇਸ ਤਨ ਮਾਹਿ ਮਿਟਾਵਉ" },
      { gurmukhi_speech: "ਨਾਮੁ ਜਪਤ ਅਗਨਤ ਅਨੇਕੈ" },
    ];
    const loneMatch = findStrongOfflinePanktiMatch(loaded, "ਕਲਿ ਕਲੇਸ ਅਗਨਤ", 1, 1);
    expect(loneMatch?.panktiIdx).toBe(2);
    expect(stabilizeOfflinePanktiMatch(1, loneMatch, null).currentIdx).toBe(1);
    expect(stabilizeOfflinePanktiMatch(1, loneMatch, { panktiIdx: 2, confirmations: 1 }).currentIdx).toBe(2);
    expect(findStrongOfflinePanktiMatch(loaded, "ਅਗਨਤ ਹੁਣ", 1, 1)).toBeNull();
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
  it("tracks the uploaded Aisi Kirpa recording against its canonical Shabad panktis", () => {
    const recordedShabad = [
      "ਬਿਲਾਵਲੁ ਮਹਲਾ ਪੰਜਵਾ",
      "ਐਸੀ ਕਿਰਪਾ ਮੋਹਿ ਕਰਹੁ",
      "ਸੰਤਹ ਚਰਣ ਹਮਾਰੋ ਮਾਥਾ ਨੈਨ ਦਰਸੁ ਤਨਿ ਧੂਰਿ ਪਰਹੁ",
      "ਗੁਰ ਕੋ ਸਬਦੁ ਮੇਰੈ ਹੀਅਰੈ ਬਾਸੈ ਹਰਿ ਨਾਮਾ ਮਨ ਸੰਗਿ ਧਰਹੁ",
      "ਤਸਕਰ ਪੰਚ ਨਿਵਾਰਹੁ ਠਾਕੁਰ ਸਗਲੋ ਭਰਮਾ ਹੋਮਿ ਜਰਹੁ",
      "ਜੋ ਤੁਮ ਕਰਹੁ ਸੋਈ ਭਲ ਮਾਨੈ ਭਾਵਨੁ ਦੁਬਿਧਾ ਦੂਰਿ ਟਰਹੁ",
      "ਨਾਨਕ ਕੇ ਪ੍ਰਭ ਤੁਮ ਹੀ ਦਾਤੇ ਸੰਤਸੰਗਿ ਲੇ ਮੋਹਿ ਉਧਰਹੁ",
    ].map(gurmukhi_speech => ({ gurmukhi_speech }));

    // These are words emitted by the bundled model on sampled windows from
    // the uploaded recording. Preserve the DB's canonical line order.
    expect(findStrongOfflinePanktiMatch(recordedShabad, "ਐਸੀ ਕ੍ਰਿਪਾ ਹੋਇ")?.panktiIdx).toBe(1);
    expect(findStrongOfflinePanktiMatch(recordedShabad, "ਚਰਨ ਹਮਾਰੋ ਮਾਤਾ")?.panktiIdx).toBe(2);
    expect(findStrongOfflinePanktiMatch(recordedShabad, "ਪੰਚ ਨਿਵਾਰਹੁ ਠਾਕੁਰ")?.panktiIdx).toBe(4);
    expect(findStrongOfflinePanktiMatch(recordedShabad, "ਸੋਈ ਭਗਵਾਨੈ")).toBeNull();
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
  it("moves immediately to a strongly heard next Pankti in canonical order", () => {
    expect(stabilizeOfflinePanktiMatch(2, {
      panktiIdx: 3, matchedWords: 3, exactWords: 3, tokenEndIndex: 5,
    }, null)).toEqual({ currentIdx: 3, pending: null });
  });
  it("confirms short jumps and ignores backward Pankti matches", () => {
    const short = { panktiIdx: 1, matchedWords: 2, exactWords: 2, tokenEndIndex: 3 };
    const first = stabilizeOfflinePanktiMatch(0, short, null);
    expect(first).toEqual({ currentIdx: 0, pending: { panktiIdx: 1, confirmations: 1 } });
    expect(stabilizeOfflinePanktiMatch(0, short, first.pending)).toEqual({ currentIdx: 1, pending: null });

    const outOfOrder = { panktiIdx: 4, matchedWords: 4, exactWords: 4, tokenEndIndex: 8 };
    expect(stabilizeOfflinePanktiMatch(1, outOfOrder, null)).toEqual({ currentIdx: 4, pending: null });

    const backwards = { panktiIdx: 0, matchedWords: 5, exactWords: 5, tokenEndIndex: 9 };
    expect(stabilizeOfflinePanktiMatch(1, backwards, null)).toEqual({ currentIdx: 1, pending: null });

    expect(stabilizeOfflinePanktiMatch(0, short, null, 2)).toEqual({
      currentIdx: 1,
      pending: null,
    });
  });
  it("prefers the next canonical occurrence when a repeated line is equally supported", () => {
    const repeated = [
      { gurmukhi_speech: "ਕਰ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ" },
      { gurmukhi_speech: "ਕਰ ਕ੍ਰਿਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ" },
    ];
    expect(findStrongOfflinePanktiMatch(
      repeated,
      "ਕਰ ਕਿਰਪਾ ਪ੍ਰਭ ਦੀਨ ਦਇਆਲਾ",
      2,
      0,
    )?.panktiIdx).toBe(1);
  });
  it("auto-advances after the current Pankti's final words are present at the live transcript edge", () => {
    const paath = [
      { gurmukhi_speech: "ਪਹਿਲੀ ਪੰਕਤੀ ਦੇ ਆਖਰੀ ਸ਼ਬਦ" },
      { gurmukhi_speech: "ਅਗਲੀ ਪੰਕਤੀ ਦੇ ਸ਼ੁਰੂ ਸ਼ਬਦ" },
    ];
    const completed = findCompletedOfflinePankti(paath, "ਪਹਿਲੀ ਪੰਕਤੀ ਦੇ ਆਖਰੀ ਸ਼ਬਦ", 0);
    expect(completed).toMatchObject({ panktiIdx: 1, matchedWords: 3, tokenEndIndex: 4 });
    expect(stabilizeOfflinePanktiMatch(0, completed, null).currentIdx).toBe(1);
  });
  it("does not auto-advance from old ending words or a single final word", () => {
    const paath = [
      { gurmukhi_speech: "ਪਹਿਲੀ ਪੰਕਤੀ ਦੇ ਆਖਰੀ ਸ਼ਬਦ" },
      { gurmukhi_speech: "ਅਗਲੀ ਪੰਕਤੀ ਦੇ ਸ਼ੁਰੂ ਸ਼ਬਦ" },
    ];
    expect(findCompletedOfflinePankti(paath, "ਪਹਿਲੀ ਪੰਕਤੀ ਦੇ ਆਖਰੀ ਸ਼ਬਦ ਅਗਲੀ", 0)).toBeNull();
    expect(findCompletedOfflinePankti(paath, "ਆਖਰੀ ਸ਼ਬਦ", 0)).toMatchObject({
      panktiIdx: 1,
      matchedWords: 2,
    });
    expect(findCompletedOfflinePankti(paath, "ਸ਼ਬਦ", 0)).toBeNull();
  });
  it("tracks Sukhmani Sahib Panktis from one or two live words and advances on a completed line", () => {
    // Canonical order and text from additional_assets/bani.db, Bani ID 12.
    const sukhmani = [
      { gurmukhi_speech: "ਸਿਮਰਉ ਸਿਮਰਿ ਸਿਮਰਿ ਸੁਖੁ ਪਾਵਉ" },
      { gurmukhi_speech: "ਕਲਿ ਕਲੇਸ ਤਨ ਮਾਹਿ ਮਿਟਾਵਉ" },
      { gurmukhi_speech: "ਸਿਮਰਉ ਜਾਸੁ ਬਿਸੁੰਭਰ ਏਕੈ" },
      { gurmukhi_speech: "ਨਾਮੁ ਜਪਤ ਅਗਨਤ ਅਨੇਕੈ" },
      { gurmukhi_speech: "ਬੇਦ ਪੁਰਾਨ ਸਿੰਮ੍ਰਿਤਿ ਸੁਧਾਖੵਰ" },
      { gurmukhi_speech: "ਕੀਨੇ ਰਾਮ ਨਾਮ ਇਕ ਆਖੵਰ" },
      { gurmukhi_speech: "ਕਿਨਕਾ ਏਕ ਜਿਸੁ ਜੀਅ ਬਸਾਵੈ" },
      { gurmukhi_speech: "ਤਾ ਕੀ ਮਹਿਮਾ ਗਨੀ ਨ ਆਵੈ" },
      { gurmukhi_speech: "ਕਾਂਖੀ ਏਕੈ ਦਰਸ ਤੁਹਾਰੋ" },
      { gurmukhi_speech: "ਨਾਨਕ ਉਨ ਸੰਗਿ ਮੋਹਿ ਉਧਾਰੋ" },
      { gurmukhi_speech: "ਸੁਖਮਨੀ ਸੁਖ ਅੰਮ੍ਰਿਤ ਪ੍ਰਭ ਨਾਮੁ" },
      { gurmukhi_speech: "ਭਗਤ ਜਨਾ ਕੈ ਮਨਿ ਬਿਸ੍ਰਾਮ ਰਹਾਉ" },
      { gurmukhi_speech: "ਪ੍ਰਭ ਕੈ ਸਿਮਰਨਿ ਗਰਭਿ ਨ ਬਸੈ" },
      { gurmukhi_speech: "ਪ੍ਰਭ ਕੈ ਸਿਮਰਨਿ ਦੂਖੁ ਜਮੁ ਨਸੈ" },
      { gurmukhi_speech: "ਪ੍ਰਭ ਕੈ ਸਿਮਰਨਿ ਕਾਲੁ ਪਰਹਰੈ" },
      { gurmukhi_speech: "ਪ੍ਰਭ ਕੈ ਸਿਮਰਨਿ ਦੁਸਮਨੁ ਟਰੈ" },
    ];
    const firstLine = "ਸਿਮਰ ਸਿਮਰ ਸੁਖ ਪਾਵਹੁ";
    expect(findStrongOfflinePanktiMatch(sukhmani, firstLine, 2, 0)?.panktiIdx).toBe(0);
    const completedFirst = findCompletedOfflinePankti(sukhmani, firstLine, 0);
    expect(completedFirst).toMatchObject({ panktiIdx: 1, matchedWords: 3 });
    const completionConfirmation = stabilizeOfflinePanktiMatch(0, completedFirst, null, 3);
    expect(stabilizeOfflinePanktiMatch(
      completionConfirmation.currentIdx,
      completedFirst,
      completionConfirmation.pending,
      3,
    ).currentIdx).toBe(1);

    // A two-word suffix is enough to show the current line, then the line's
    // final two words advance one canonical position in order.
    const nextPankti = findStrongOfflinePanktiMatch(
      sukhmani,
      "ਸਿਮਰ ਸਿਮਰ ਸੁਖ ਪਾਵਹੁ ਕਲ ਤਨ ਮਾਹਿ",
      2,
      1,
    );
    expect(nextPankti?.panktiIdx).toBe(1);
    const noisyNext = stabilizeOfflinePanktiMatch(0, nextPankti, null, 3);
    expect(noisyNext.currentIdx).toBe(0);
    expect(stabilizeOfflinePanktiMatch(0, nextPankti, noisyNext.pending, 3).currentIdx).toBe(1);
    expect(findStrongOfflinePanktiMatch(
      sukhmani,
      "ਸਿਮਰ ਸਿਮਰ ਸੁਖ ਪਾਵਹੁ ਕਲ ਤਨ ਮਾਹਿ ਨਾਮੁ ਜਪਤ ਅਗਨਤ",
      1,
      2,
    )?.panktiIdx).toBe(3);
    expect(findCompletedOfflinePankti(
      sukhmani,
      "ਕਲਿ ਕਲੇਸ ਤਨ ਮਾਹਿ ਮਿਟਾਵਉ",
      1,
    )?.panktiIdx).toBe(2);

    // This is the rolling transcript produced from the checked-in MP3. Its
    // final two words must select the last matching canonical Pankti.
    const liveTranscript = "ਸਿਮਰ ਸਿਮਰ ਸੁਖ ਪਾਵਹੁ ਕਲ ਤਨ ਮਾਹਿ ਜਾਸ ਏਕੈ ਅਗਨਤ ਬੇਦ ਕੀਨੇ ਰਾਮ ਨਾਮ ਇਕ ਕਿਨਕਾ ਏਕ ਜਿਸ ਜੀਅ ਬਸਾਵੈ ਤਾ ਕੀ ਮਹਿਮਾ ਗਨੀ ਨ ਆਵੈ ਏਕੈ ਦਰਸ ਤੁਹਾਰੋ ਨਾਨਕ ਸੰਗ ਮੋਹਿ ਉਧਾਰੋ ਸੁਖ ਅੰਮ੍ਰਿਤ ਪ੍ਰਭ ਨਾਮ ਭਗਤ ਜਨਾ ਕੈ ਮਨ ਬਿਸ੍ਰਾਮ ਰਹਾਉ ਪ੍ਰਭ ਕੈ ਸਿਮਰਨ ਗਰਭ ਨ ਬਸੈ ਪ੍ਰਭ ਕੈ ਸਿਮਰਨ ਦੂਖ ਜਮ ਪ੍ਰਭ ਕੈ ਸਿਮਰਨ ਕਾਲ ਪ੍ਰਭ ਕੈ ਸਿਮਰਨ ਦੁਸਮਨ ਟਰੈ";
    const lastLine = findStrongOfflinePanktiMatch(sukhmani, liveTranscript, 1, 0);
    expect(lastLine?.panktiIdx).toBe(15);
    expect(stabilizeOfflinePanktiMatch(0, lastLine, null)).toEqual({
      currentIdx: 15,
      pending: null,
    });

    const fullRecordingLive = "ਸਿਮਰਹੁ ਸਿਮਰ ਸਿਮਰ ਸੁਖ ਪਾਵਹੁ ਤਨ ਮਾਹਿ ਸਿਮਰਉ ਜਾਸ ਏਕੈ ਨਾਮ ਅਗਨਤ ਅਨੇਕੈ ਬੇਦ ਕੀਨੇ ਰਾਮ ਨਾਮ ਇਕ ਆਖਰ ਕਿਨਕਾ ਏਕ ਜਿਸ ਜੀਅ ਬਸਾਵੈ ਤਾ ਕੀ ਮਹਿਮਾ ਗਨੀ ਤੁਹਾਰੋ ਨਾਨਕ ਉਨ ਸੰਗ ਮੋਹਿ ਉਧਾਰੋ ਸੁਖ ਅੰਮ੍ਰਿਤ ਪ੍ਰਭ ਨਾਮ ਭਗਤ ਜਨਾ ਕੈ ਮਨ ਬਿਸ੍ਰਾਮ ਰਹਾਉ ਪ੍ਰਭ ਕੈ ਸਿਮਰਨ ਗਰਭ ਨ ਬਸੈ ਪ੍ਰਭ ਕੈ ਸਿਮਰਨ ਦੂਖ ਜਮ ਪ੍ਰਭ ਕੈ ਸਿਮਰਨ ਹਰੈ ਪ੍ਰਭ ਕੈ ਸਿਮਰਨ ਦੁਸਮਨ ਟਰੈ";
    const fullRecordingMatch = findStrongOfflinePanktiMatch(sukhmani, fullRecordingLive, 2, 0);
    expect(fullRecordingMatch?.panktiIdx).toBe(15);
    const firstConfirmation = stabilizeOfflinePanktiMatch(0, fullRecordingMatch, null, 3);
    expect(firstConfirmation.currentIdx).toBe(15);
    expect(stabilizeOfflinePanktiMatch(
      firstConfirmation.currentIdx,
      fullRecordingMatch,
      firstConfirmation.pending,
      3,
    ).currentIdx).toBe(15);
    const fullRecordingCandidates = sukhmani.map((pankti, index) => ({
      id: String(index),
      shabad_id: index < 10 ? "45C" : "ULS",
      order_id: index,
      ...pankti,
    }));
    // A long, noisy live suffix makes single-line scoring ambiguous across
    // Sukhmani's repeated "ਪ੍ਰਭ ਕੈ ਸਿਮਰਨਿ" lines. Ordered segment evidence
    // still identifies the later stanza, and selecting it loads the whole bani.
    expect(selectOfflinePankti(fullRecordingLive, fullRecordingCandidates)).toBeNull();
    expect(selectOfflineShabadFromSegments(
      buildOfflineSearchSegments(fullRecordingLive),
      fullRecordingCandidates,
    )).toMatchObject({ shabadId: "ULS", panktiId: "15" });
  });
});
