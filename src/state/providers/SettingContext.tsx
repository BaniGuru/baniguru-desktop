import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type LangType = "ਗੁਰਮੁਖੀ" | "ਪੰਜਾਬੀ" | "English" | "Next Pankti" | "Akhand Paath";

type Theme = {
  name: string;
};

type Settings = {
  visibility: Record<LangType, boolean>;
  panelSetting: {
    panelWidth: number;
    panelHeight: number;
  };
  autoSearch: boolean;
  audioStream: boolean;
  autoNext: boolean;
  panelLocation: string;
  width: number;
  height: number;
  version: string;

  themes: Theme[];
  activeThemeName: string;

  updateSetting: (key: "width" | "height", value: number) => void;
  updatePanelSetting: (key: "panelWidth" | "panelHeight", value: number) => void;
  updateVersion: (version: string) => void;

  setActiveTheme: (name: string) => void;

  getActiveTheme: () => Theme;

  setVisibility: any;
  setMicName: (name: string) => void;
  micName: string | null;
  speechRegion: string;
  setSpeechRegion: (region: string) => void;
  settingVersion: string;
  setPanelLocation: (location: string) => void;
  setAutoSearch: (autoSearch: boolean) => void;
  setAudioStream: (audioStream: boolean) => void;
  setAutoNext: (autoNext: boolean) => void;
};

const defaultVisibility: Record<LangType, boolean> = {
  "ਗੁਰਮੁਖੀ": true,
  "ਪੰਜਾਬੀ": true,
  "English": true,
  "Next Pankti": true,
  "Akhand Paath": false,
};

const defaultPanelSetting = {
  panelWidth: 33,
  panelHeight: 33,
  panelFontSize: 12,
};

const defaultRegion = "us";
const defaultWidth = 800;
const defaultHeight = 600;
const settingVersion = "0.0.1.2";
export const appVersion = "0.0.1";

const defaultThemes: Theme[] = [
  {name: "BaniGuru"},
  { name: "Light" },
  { name: "Blue" },
  { name: "Dark" },
  { name: "Darker" },
  { name: "Sepia" },
  { name: "ShabadOs1" },
  { name: "ShabadOs2" },
  { name: "Bandi Chorh Diwas" },
  { name: "Guru Nanak Dev Ji" }
];

const LOCAL_STORAGE_KEY = "settings";
const defaultPanelLocation = "right";

const getDefaultSettings = (): Settings => ({
  panelSetting: defaultPanelSetting,
  panelLocation: defaultPanelLocation,
  width: defaultWidth,
  height: defaultHeight,
  version: "",
  themes: defaultThemes,
  activeThemeName: defaultThemes[0].name,
  visibility: defaultVisibility,
  micName: "",
  autoSearch: false,
  audioStream: false,
  autoNext: false,

  setPanelLocation: () => { },
  updateSetting: () => { },
  updatePanelSetting: () => { },
  updateVersion: () => { },
  setActiveTheme: () => { },
  getActiveTheme: () => defaultThemes[0],
  setVisibility: () => { },
  setMicName: () => { },
  speechRegion: defaultRegion,
  setSpeechRegion: () => {},
  settingVersion: settingVersion,
  setAutoSearch: () => { },
  setAudioStream: () => { },
  setAutoNext: () => { },
});

const getInitialSettings = () => {
  let settings = getDefaultSettings();
  let storageSettings = false;

  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.settingVersion && parsed.settingVersion === settingVersion) {
        settings = {
          ...settings,
          visibility: { ...(parsed.visibility ?? defaultVisibility), "Akhand Paath": false },
          panelSetting: { ...defaultPanelSetting, ...parsed.panelSetting },
          width: parsed.width ?? defaultWidth,
          height: parsed.height ?? defaultHeight,
          version: parsed.version ?? "",
          themes: parsed.themes ?? defaultThemes,
          activeThemeName: parsed.activeThemeName ?? defaultThemes[0],
          micName: parsed.micName ?? "",
          speechRegion: parsed.speechRegion ?? defaultRegion,
          autoSearch: parsed.autoSearch ?? false,
          audioStream: parsed.audioStream ?? false,
        };
        storageSettings = true;
      }
    }

    if (!storageSettings) {
      storeSettings(settings);
    }

  } catch (e) {
    console.warn("Error loading settings from localStorage:", e);
  }

  return settings;
};

const SettingContext = createContext<Settings | undefined>(undefined);

const storeSettings = (settings: any) => {
  localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify({
      visibility: settings.visibility,
      width: settings.width,
      height: settings.height,
      version: settings.version,
      panelSetting: settings.panelSetting,
      themes: settings.themes,
      activeThemeName: settings.activeThemeName,
      micName: settings.micName,
      settingVersion: settingVersion,
      autoSearch: settings.autoSearch,
      speechRegion: settings.speechRegion,
      audioStream: settings.audioStream,
    })
  );
};

export const SettingProvider = ({ children }: { children: React.ReactNode }) => {
  const initial = getInitialSettings();

  const [visibility, setVisibility] = useState<Record<LangType, boolean>>(initial.visibility);
  const [panelSetting, setPanelSetting] = useState(initial.panelSetting);
  const [width, setWidth] = useState(initial.width);
  const [height, setHeight] = useState(initial.height);
  const [version, setVersion] = useState(initial.version);
  const [micName, setMicName] = useState(initial.micName);
  const [panelLocation, setPanelLocation] = useState(initial.panelLocation);
  const [autoSearch, setAutoSearch] = useState(initial.autoSearch);
  const [audioStream, setAudioStream] = useState(initial.audioStream);
  const [autoNext, setAutoNext] = useState(true);
  const [speechRegion, setSpeechRegion] = useState<string>(initial.speechRegion);

  const themes = initial.themes;
  const [activeThemeName, setActiveThemeName] = useState<string>(initial.activeThemeName);

  const activeTheme = useMemo<Theme>(() => {
    const found = themes.find(t => t.name === activeThemeName);
    return found ?? themes[0];
  }, [themes, activeThemeName]);

  useEffect(() => {
    storeSettings({
      visibility,
      width,
      height,
      version,
      panelSetting,
      themes,
      activeThemeName,
      micName,
      panelLocation,
      autoSearch,
      speechRegion,
      audioStream
    });
  }, [
    visibility, width, height, version, panelSetting, themes, activeThemeName, micName, panelLocation,
    autoSearch,
    speechRegion,
    audioStream,
  ]);

  const updateSetting = (key: "width" | "height", value: number) => {
    if (key === "width") setWidth(value);
    else setHeight(value);
  };

  const updatePanelSetting = (key: "panelWidth" | "panelHeight", value: number) => {
    if (key === "panelWidth") {
      setPanelSetting(prev => ({...prev, 'panelWidth': value}));
    } else {
      setPanelSetting(prev => ({...prev, 'panelHeight': value}));
    }
  }

  const updateVersion = (v: string) => setVersion(v);

  const setActiveTheme = (name: string) => {
    setActiveThemeName(prev => (themes.some(t => t.name === name) ? name : prev));
  };

  const getActiveTheme = () => activeTheme;

  return (
    <SettingContext.Provider
      value={{
        visibility,
        panelSetting,
        panelLocation,
        setPanelLocation,
        width,
        height,
        version,
        themes,
        activeThemeName,
        settingVersion,
        updateSetting,
        updatePanelSetting,
        updateVersion,
        setActiveTheme,
        getActiveTheme,
        setVisibility,
        setMicName,
        micName,
        autoSearch,
        setAutoSearch,
        audioStream,
        setAudioStream,
        autoNext,
        setAutoNext,
        speechRegion,
        setSpeechRegion,
      }}
    >
      {children}
    </SettingContext.Provider>
  );
};

export const useSettings = () => {
  const ctx = useContext(SettingContext);
  if (!ctx) {
    console.warn("useSettings() called outside SettingProvider, returning defaults");

    return getDefaultSettings();
  }

  return ctx;
};
