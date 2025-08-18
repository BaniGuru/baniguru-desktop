import { createContext, useContext, useState, useEffect } from "react";

type FontType = "ਗੁਰਮੁਖੀ" | "ਪੰਜਾਬੀ" | "English" | "Next Pankti" | "Search";

type Settings = {
  fontSizes: Record<FontType, number>;
  panelSetting: {
    panelWidth: number;
    panelHeight: number;
    panelFontSize: number;
  }
  displaySpacing: {
    startSpace: number;
    endSpace: number;
    leftSpace: number;
    gurmukhiSpace: number;
    translationSpace: number;
  };
  width: number;
  height: number;
  updateFontSize: (font: FontType, size: number) => void;
  updateSpacing: (key: keyof Settings["displaySpacing"], value: number) => void;
  updateSetting: (key: "width" | "height", value: number) => void;
  updatePanelSetting: (key: keyof Settings["panelSetting"], value: number) => void;
};

const defaultFontSizes: Record<FontType, number> = {
  "ਗੁਰਮੁਖੀ": 90,
  "ਪੰਜਾਬੀ": 50,
  "English": 45,
  "Next Pankti": 70,
  "Search": 20,
};

const defaultDisplaySpacing = {
  startSpace: 10,
  endSpace: 10,
  leftSpace: 10,
  gurmukhiSpace: 12,
  translationSpace: 10,
};

const defaultPanelSetting = {
  panelWidth: 33,
  panelHeight: 33,
  panelFontSize: 12,
}

const defaultWidth = 800;
const defaultHeight = 600;

const LOCAL_STORAGE_KEY = "settings";

const getInitialSettings = () => {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        fontSizes: { ...defaultFontSizes, ...parsed.fontSizes },
        displaySpacing: { ...defaultDisplaySpacing, ...parsed.displaySpacing },
        panelSetting: {...defaultPanelSetting, ...parsed.panelSetting},
        width: parsed.width ?? defaultWidth,
        height: parsed.height ?? defaultHeight,
      };
    }
  } catch (e) {
    console.warn("Error loading settings from localStorage:", e);
  }

  return {
    fontSizes: defaultFontSizes,
    displaySpacing: defaultDisplaySpacing,
    panelSetting: defaultPanelSetting,
    width: defaultWidth,
    height: defaultHeight,
  };
};

const SettingContext = createContext<Settings | undefined>(undefined);

export const SettingProvider = ({ children }: { children: React.ReactNode }) => {
  const initialSettings = getInitialSettings();

  const [fontSizes, setFontSizes] = useState<Record<FontType, number>>(initialSettings.fontSizes);
  const [displaySpacing, setDisplaySpacing] = useState(initialSettings.displaySpacing);
  const [panelSetting, setPanelSetting] = useState(initialSettings.panelSetting);
  const [width, setWidth] = useState(initialSettings.width);
  const [height, setHeight] = useState(initialSettings.height);

  // Save settings to localStorage on change
  useEffect(() => {
    const allSettings = {
      fontSizes,
      displaySpacing,
      width,
      height,
      panelSetting
    };
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allSettings));
  }, [fontSizes, displaySpacing, width, height, panelSetting]);

  const updateFontSize = (font: FontType, size: number) => {
    setFontSizes((prev) => ({
      ...prev,
      [font]: size,
    }));
  };

  const updateSpacing = (
    key: keyof Settings["displaySpacing"],
    value: number
  ) => {
    setDisplaySpacing((prev: any) => ({
      ...prev,
      [key]: value,
    }));
  };

  const updateSetting = (key: "width" | "height", value: number) => {
    if (key === "width") setWidth(value);
    if (key === "height") setHeight(value);
  };

  const updatePanelSetting = (
    key: keyof Settings["panelSetting"],
    value: number
  ) => {
    setPanelSetting((prev: any) => ({
      ...prev,
      [key]: value,
    }));
  };

  return (
    <SettingContext.Provider
      value={{
        fontSizes,
        displaySpacing,
        panelSetting,
        width,
        height,
        updateFontSize,
        updateSpacing,
        updateSetting,
        updatePanelSetting,
      }}
    >
      {children}
    </SettingContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingProvider");
  }
  return context;
};
