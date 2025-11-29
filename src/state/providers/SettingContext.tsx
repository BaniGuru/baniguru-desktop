import { createContext, useContext, useEffect, useMemo, useState } from "react";

/* =========================
   Types
   ========================= */
type FontType = "ਗੁਰਮੁਖੀ" | "ਪੰਜਾਬੀ" | "English" | "Next Pankti" | "Search";

export type LangType = "ਗੁਰਮੁਖੀ" | "ਪੰਜਾਬੀ" | "English" | "Next Pankti" | "Akhand Paath";

type Margin = [top: number, left: number, right: number, bottom: number];

type Theme = {
  name: string;
  margin: Margin;
};

type Settings = {
  fontSizes: Record<FontType, number>;
  visibility: Record<LangType, boolean>;
  panelSetting: {
    panelWidth: number;
    panelHeight: number;
    panelFontSize: number;
  };
  displaySpacing: {
    startSpace: number;
    endSpace: number;
    leftSpace: number;
    rightSpace: number,
    gurmukhiSpace: number;
    translationSpace: number;
  };
  width: number;
  height: number;
  version: string;

  /** Multi-theme support */
  themes: Theme[];
  activeThemeName: string;

  /** Existing updaters */
  updateFontSize: (font: FontType, size: number) => void;
  updateSpacing: (key: keyof Settings["displaySpacing"], value: number) => void;
  updateSetting: (key: "width" | "height", value: number) => void;
  updatePanelSetting: (key: keyof Settings["panelSetting"], value: number) => void;
  updateVersion: (version: string) => void;

  /** Theme CRUD + selection */
  addTheme: (theme: Theme) => void;
  updateTheme: (name: string, patch: Partial<Omit<Theme, "name">> & { name?: string }) => void;
  removeTheme: (name: string) => void;
  setActiveTheme: (name: string) => void;

  /** Helpers */
  getActiveTheme: () => Theme;
  getThemeMarginBaseline: (name?: string) => Margin;
  isThemeMarginDefault: (name?: string) => boolean;
  setThemeMarginToDefault: (name?: string) => void;

  setVisibility: any;
};

/* =========================
   Defaults
   ========================= */
const defaultFontSizes: Record<FontType, number> = {
  "ਗੁਰਮੁਖੀ": 90,
  "ਪੰਜਾਬੀ": 50,
  "English": 45,
  "Next Pankti": 70,
  "Search": 20,
};

const defaultVisibility: Record<LangType, boolean> = {
  "ਗੁਰਮੁਖੀ": true,
  "ਪੰਜਾਬੀ": true,
  "English": true,
  "Next Pankti": true,
  "Akhand Paath": false,
};

const defaultDisplaySpacing = {
  startSpace: 10,
  endSpace: 10,
  leftSpace: 10,
  rightSpace: 10,
  gurmukhiSpace: 12,
  translationSpace: 10,
};

const defaultPanelSetting = {
  panelWidth: 33,
  panelHeight: 33,
  panelFontSize: 12,
};

const defaultWidth = 800;
const defaultHeight = 600;
export const appVersion = "0.0.1";

const defaultThemes: Theme[] = [
  { name: "Light", margin: [0, 0, 0, 0] },
  { name: "Blue",  margin: [0, 0, 0, 0] },
  { name: "Dark",  margin: [0, 0, 0, 0] },
  { name: "Sepia",  margin: [0, 0, 0, 0] },
  { name: "ShabadOs1", margin: [0, 0, 0, 0] },
  { name: "ShabadOs2", margin: [0, 0, 0, 0] },
  { name: "Bandi Chorh Diwas", margin: [0, 0, 0, 0] },
  { name: "Guru Nanak Dev Ji", margin: [0, 0, 0, 0] }
];

const LOCAL_STORAGE_KEY = "settings";

/** Global fallback baseline margin if a theme has no entry in defaultThemes */
const GLOBAL_DEFAULT_MARGIN: Margin = [0, 0, 0, 0];

/* =========================
   Utils
   ========================= */
const marginsEqual = (a: Margin, b: Margin) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

/* =========================
   Load (with migration & reconciliation)
   ========================= */
const getInitialSettings = () => {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);

      // 1) Gather saved themes (support old single-theme saves)
      let savedThemes: Theme[] | undefined = parsed.themes;
      let savedActiveThemeName: string | undefined = parsed.activeThemeName;

      if (!savedThemes) {
        // Old shape: { theme: { name } }
        if (parsed.theme?.name) {
          savedThemes = [{ name: parsed.theme.name, margin: GLOBAL_DEFAULT_MARGIN }];
          savedActiveThemeName = parsed.theme.name;
        }
      }

      // Normalize: ensure array
      if (!Array.isArray(savedThemes) || savedThemes.length === 0) {
        savedThemes = [];
      }

      // 2) Reconcile with defaultThemes:
      //    - Keep themes that exist in defaultThemes (preserve saved margins)
      //    - Add any default themes missing from saved
      //    - Drop any saved themes not present in defaultThemes
      const savedMap = new Map<string, Theme>(savedThemes.map(t => [t.name, t]));
      const reconciledThemes: Theme[] = defaultThemes.map(def =>
        savedMap.get(def.name) ?? def
      );

      // 3) Active theme validation/fallback
      let activeThemeName = savedActiveThemeName ?? defaultThemes[0].name;
      if (!reconciledThemes.some(t => t.name === activeThemeName)) {
        activeThemeName = defaultThemes[0].name;
      }

      return {
        fontSizes: { ...defaultFontSizes, ...parsed.fontSizes },
        visibility: {...(parsed.visibility ?? defaultVisibility), "Akhand Paath": false},
        displaySpacing: { ...defaultDisplaySpacing, ...parsed.displaySpacing },
        panelSetting: { ...defaultPanelSetting, ...parsed.panelSetting },
        width: parsed.width ?? defaultWidth,
        height: parsed.height ?? defaultHeight,
        version: parsed.version ?? "",
        themes: reconciledThemes,
        activeThemeName,
      };
    }
  } catch (e) {
    console.warn("Error loading settings from localStorage:", e);
  }

  // Fresh install defaults
  return {
    fontSizes: defaultFontSizes,
    displaySpacing: defaultDisplaySpacing,
    panelSetting: defaultPanelSetting,
    width: defaultWidth,
    height: defaultHeight,
    version: "",
    themes: defaultThemes,
    activeThemeName: defaultThemes[0].name,
  };
};

/* =========================
   Context
   ========================= */
const SettingContext = createContext<Settings | undefined>(undefined);

/* =========================
   Provider
   ========================= */
export const SettingProvider = ({ children }: { children: React.ReactNode }) => {
  const initial = getInitialSettings();

  const [fontSizes, setFontSizes] = useState<Record<FontType, number>>(initial.fontSizes);
  const [visibility, setVisibility] = useState<Record<LangType, boolean>>(initial.visibility);
  const [displaySpacing, setDisplaySpacing] = useState(initial.displaySpacing);
  const [panelSetting, setPanelSetting] = useState(initial.panelSetting);
  const [width, setWidth] = useState(initial.width);
  const [height, setHeight] = useState(initial.height);
  const [version, setVersion] = useState(initial.version);

  // Themes
  const [themes, setThemes] = useState<Theme[]>(initial.themes);
  const [activeThemeName, setActiveThemeName] = useState<string>(initial.activeThemeName);

  // Derived: active theme object (always valid)
  const activeTheme = useMemo<Theme>(() => {
    const found = themes.find(t => t.name === activeThemeName);
    return found ?? themes[0];
  }, [themes, activeThemeName]);

  // Persist everything
  useEffect(() => {
    localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({
        fontSizes,
        visibility,
        displaySpacing,
        width,
        height,
        version,
        panelSetting,
        themes,
        activeThemeName,
      })
    );
  }, [fontSizes, visibility, displaySpacing, width, height, version, panelSetting, themes, activeThemeName]);

  /* ----- Existing updaters ----- */
  const updateFontSize = (font: FontType, size: number) => {
    setFontSizes(prev => ({ ...prev, [font]: size }));
  };

  const updateSpacing = (key: keyof Settings["displaySpacing"], value: number) => {
    setDisplaySpacing((prev: any) => ({ ...prev, [key]: value }));
  };

  const updateSetting = (key: "width" | "height", value: number) => {
    if (key === "width") setWidth(value);
    else setHeight(value);
  };

  const updatePanelSetting = (key: keyof Settings["panelSetting"], value: number) => {
    setPanelSetting((prev: any) => ({ ...prev, [key]: value }));
  };

  const updateVersion = (v: string) => setVersion(v);

  /* ----- Theme CRUD + selection ----- */
  const addTheme = (theme: Theme) => {
    setThemes(prev => {
      if (prev.some(t => t.name === theme.name)) return prev; // prevent dup names
      return [...prev, theme];
    });
  };

  const updateTheme = (name: string, patch: Partial<Omit<Theme, "name">> & { name?: string }) => {
    setThemes(prev => {
      const idx = prev.findIndex(t => t.name === name);
      if (idx === -1) return prev;

      const nextName = patch.name ?? prev[idx].name;
      // Prevent renaming to an existing name
      if (nextName !== name && prev.some((t, i) => i !== idx && t.name === nextName)) {
        return prev;
      }

      const updated = { ...prev[idx], ...patch, name: nextName };
      const next = [...prev];
      next[idx] = updated;

      // Keep active selection in sync if renamed
      if (activeThemeName === name && nextName !== name) {
        setActiveThemeName(nextName);
      }
      return next;
    });
  };

  const removeTheme = (name: string) => {
    setThemes(prev => {
      const filtered = prev.filter(t => t.name !== name);
      if (filtered.length === 0) {
        // Always keep at least one theme
        const fallback = defaultThemes;
        setActiveThemeName(fallback[0].name);
        return fallback;
      }
      if (activeThemeName === name) {
        setActiveThemeName(filtered[0].name);
      }
      return filtered;
    });
  };

  const setActiveTheme = (name: string) => {
    setActiveThemeName(prev => (themes.some(t => t.name === name) ? name : prev));
  };

  const getActiveTheme = () => activeTheme;

  /* ----- Default vs custom margin helpers ----- */

  // Returns the baseline/default margin for a theme name.
  // If the theme exists in defaultThemes, use its margin; else return global fallback.
  const getThemeMarginBaseline = (name?: string): Margin => {
    const n = name ?? activeThemeName;
    const inDefaults = defaultThemes.find(t => t.name === n);
    return inDefaults?.margin ?? GLOBAL_DEFAULT_MARGIN;
  };

  // True if the theme's current margin matches its baseline/default.
  const isThemeMarginDefault = (name?: string): boolean => {
    const n = name ?? activeThemeName;
    const theme = themes.find(t => t.name === n);
    if (!theme) return true; // treat unknown as default
    return marginsEqual(theme.margin, getThemeMarginBaseline(n));
  };

  // Reset a theme's margin back to its baseline/default.
  const setThemeMarginToDefault = (name?: string) => {
    const n = name ?? activeThemeName;
    const baseline = getThemeMarginBaseline(n);
    setThemes(prev => prev.map(t => (t.name === n ? { ...t, margin: baseline } : t)));
  };

  /* ----- Provide ----- */
  return (
    <SettingContext.Provider
      value={{
        visibility,
        fontSizes,
        displaySpacing,
        panelSetting,
        width,
        height,
        version,
        themes,
        activeThemeName,
        updateFontSize,
        updateSpacing,
        updateSetting,
        updatePanelSetting,
        updateVersion,
        addTheme,
        updateTheme,
        removeTheme,
        setActiveTheme,
        getActiveTheme,
        getThemeMarginBaseline,
        isThemeMarginDefault,
        setThemeMarginToDefault,
        setVisibility,
      }}
    >
      {children}
    </SettingContext.Provider>
  );
};

/* =========================
   Hook
   ========================= */
export const useSettings = () => {
  const ctx = useContext(SettingContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingProvider");
  return ctx;
};
