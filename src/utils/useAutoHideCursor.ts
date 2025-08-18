import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Tauri window control helpers
export const minimizeWindow = () => {
  getCurrentWindow().minimize();
};

export const maximizeWindow = () => {
  getCurrentWindow().toggleMaximize(); // handles toggle in Tauri v2
};

export const closeWindow = () => {
  getCurrentWindow().close();
};

// Hook for cursor visibility and title bar display
export function useAutoHideCursor({
  delay = 3,
  titleBarThreshold = 40,
}: {
  delay?: number;             // inactivity timeout in seconds
  titleBarThreshold?: number; // pixels from top to show title bar
} = {}) {
  const [mouseVisible, setMouseVisible] = useState(true);
  const [showTitleBar, setShowTitleBar] = useState(false);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // 1. Handle cursor visibility (inactivity)
      if (!mouseVisible) setMouseVisible(true);

      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }

      inactivityTimerRef.current = setTimeout(() => {
        setMouseVisible(false);
      }, delay * 1000);

      // 2. Handle title bar visibility
      setShowTitleBar(e.clientY <= titleBarThreshold);
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [delay, titleBarThreshold, mouseVisible]);

  return { mouseVisible, showTitleBar };
}
