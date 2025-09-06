// src/state/hooks/useThemeColors.ts
import { useEffect, useMemo } from "react";
import { useSettings } from "../state/providers/SettingContext";

// import bg1 from './assets/images/guru-granth-sahib-ji-theme1.png';
import bg2 from './../assets/images/guru-granth-sahib-ji-theme2.png';

import shabados1 from './../assets/images/logo-shabados-1.png';
import shabados2 from './../assets/images/logo-shabados-2.png';

/** Define the color palette shape your UI needs */
export type ThemeColors = {
  gurmukhi: string;
  punjabi: string;
  english: string;
  background: any;
  // optional extras if you ever want:
  // accent?: string;
  // muted?: string;
};

/** Central catalog of theme color palettes.
 *  Make sure keys match the theme names you ship in defaultThemes (e.g., "Light", "Blue", "Dark" …)
 */
const THEME_CATALOG: Record<string, ThemeColors> = {
  Light: {
    gurmukhi: "#000000",
    punjabi: "#111827",   // gray-900
    english: "#111827",   // gray-900
    background: "none",
  },
  Blue:
  {
    "gurmukhi": "#ffcc33",
    "punjabi": "#b0c4de",
    "english": "#ffffff",
    "background": "linear-gradient(135deg, #0a1a3f, #243c7a)"
  },
  Dark: {
    "gurmukhi": "#ffcc00",       // Bright golden yellow (stands out well)
    "punjabi": "#ffffff",        // White text for clarity
    "english": "#e0e0e0",        // Light gray for softer balance
    "background": "linear-gradient(135deg, #000000, #333333)" // Dark gradient

  },
  Charcol: {
    "gurmukhi": "#ffd700",
    "punjabi": "#c0c0c0",
    "english": "#ffffff",
    "background": "linear-gradient(135deg, #1c1c1c, #3a3a3a)"
  },
  Sepia: {
    gurmukhi: "#000000",
    punjabi: "#111827",   // gray-900
    english: "#111827",   // gray-900
    background: `linear-gradient(135deg, rgba(225, 207, 71, 0.8), rgba(199, 144, 124, 0.8)),
        url(${bg2}) center / cover no-repeat`,
  },
  // https://github.com/shabados/presenter/blob/main/app/frontend/src/Presenter/themes/Avani.css
  ShabadOs1: {
    "gurmukhi": "#1A191A",
    "punjabi": "#302E2C",
    "english": "#413F3E",
    "background": `url(${shabados1}) center center / cover no-repeat`
  },
  ShabadOs2: {
    "gurmukhi": "#1A191A",
    "punjabi": "#302E2C",
    "english": "#413F3E",
    "background": `url(${shabados2}) center center / cover no-repeat`
  }
};

/** Optional: export palette to CSS variables for easy styling in CSS/styled-components */
const applyPaletteToCSSVariables = (palette: ThemeColors) => {
  const root = document.documentElement;
  root.style.setProperty("--shabad-bg", palette.background);
  root.style.setProperty("--shabad-gurmukhi", palette.gurmukhi);
  root.style.setProperty("--shabad-punjabi", palette.punjabi);
  root.style.setProperty("--shabad-english", palette.english);
};

export const useThemeColors = () => {
  const { activeThemeName, setActiveTheme, themes } = useSettings();

  // Only allow themes that exist in your current saved/default list
  const availableThemeNames = useMemo(
    () => Object.keys(THEME_CATALOG).filter((name) => themes.some((t) => t.name === name)),
    [themes]
  );

  const palette = useMemo<ThemeColors>(() => {
    // Prefer active; if not found, fall back to the first available; if none, to Light.
    const fromActive = THEME_CATALOG[activeThemeName];
    if (fromActive) return fromActive;
    if (availableThemeNames.length > 0) return THEME_CATALOG[availableThemeNames[0]];
    return THEME_CATALOG.Light ?? {
      gurmukhi: "#000",
      punjabi: "#111827",
      english: "#111827",
      background: "#FFF",
    };
  }, [activeThemeName, availableThemeNames]);

  // Push palette to CSS variables (optional but handy)
  useEffect(() => {
    applyPaletteToCSSVariables(palette);
  }, [palette]);

  return {
    palette,                 // { gurmukhi, punjabi, english, background }
    activeThemeName,         // string
    availableThemeNames,     // string[]
    setActiveTheme,          // (name: string) => void
  };
};
