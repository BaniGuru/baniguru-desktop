import { describe, expect, it } from "vitest";
import { selectOfflinePankti, scoreOfflinePankti } from "./offlinePanktiMatch";

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
    expect(selectOfflinePankti("ਅੰਮ੍ਰਿਤ ਨਾਮ", candidates)?.id).toBe("3");
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
});
