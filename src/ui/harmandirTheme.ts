import type { ThemeColors } from "../utils/useTheme";
// User-supplied original from gurbani.singhecloud.com/static/sync-bg1-Cq_b1Txh.png.
import background from "../assets/images/harmandir-sahib.png";

export const HARMANDIR_THEME_NAME = "Harmandir Sahib";

export const HARMANDIR_THEME: ThemeColors = {
  gurmukhi: "#080b2a",
  punjabi: "#080b2a",
  english: "#080b2a",
  background: `#fbf6ed url("${background}") center / 100% 100% no-repeat`,
  vishraam: { heavy: "#ff6500", medium: "#008b47", light: "#008b47" },
  reader: {
    topInsetVh: 6.5,
    bottomInsetVh: 4.5,
    inlineInsetVw: 5.7,
    rowGapPx: 24,
    translationGapPx: 8,
    gurmukhiWeight: 700,
    gurmukhiRatio: 1.08,
    gurmukhiMaxSize: 68,
    translationRatio: 0.52,
    translationMaxSize: 34,
    gurmukhiLineHeight: 1.25,
    translationLineHeight: 1.4,
  },
};
