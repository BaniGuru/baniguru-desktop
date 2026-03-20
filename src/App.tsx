import { useContext, useEffect, useRef, useState } from "react";
import "./App.css";
import SearchPanel from "./components/SearchPanel";
import ShabadDisplay from "./components/ShabadDisplay";
import ShabadPanel from "./components/ShabadPanel";
import { AppContext, AppState, PAGE_ANNOUNCEMENT } from "./state/providers/AppProvider";
import { Channel, invoke } from "@tauri-apps/api/core";
import { DB } from "./utils/DB";
import LoadingScreen from "./ui/LoadingScreen";
import TabIcons from "./ui/TabIcons";
import { SettingPanel } from "./components/SettingPanel";
import { RecentPanel } from "./components/RecentPanel";
import BaniPanel from "./components/BaniPanel";
import { FaPlayCircle, FaStopCircle, FaTimes, FaWindowMaximize, FaWindowMinimize } from "react-icons/fa";
import { SET_APP_PAGE, TOGGLE_PANEL } from "./state/ActionTypes";
import useShabadNavigation from "./utils/useShabadNavigation";
import styled from "styled-components";
import { appVersion, useSettings } from "./state/providers/SettingContext";
import { closeWindow, minimizeWindow, useAutoHideCursor } from "./utils/useAutoHideCursor";
import { useThemeColors } from "./utils/useTheme";
import useSpeech from "./components/SoundSearch/useSpeech";
import BaniDisplay from "./components/BaniDisplay";
import { ShabadContext } from "./state/providers/ShabadProvider";
import { useContextSelector } from "use-context-selector";
import AnnouncementPanel from "./components/AnnouncementPanel";
import { AnnouncementDisplay } from "./components/AnnouncementDisplay";


type DownloadEvent =
  | { event: "started"; data: { url: string; download_id: number; content_length: number } }
  | { event: "progress"; data: { download_id: number; chunk_length: any } }
  | { event: "finished"; data: { download_id: number } }
  | { event: "skipped"; data: {db_path: string; } } ;


interface TabPanelProps {
    width: number;
    height: number;
    fontSize: number;
}

const AppPanel = styled.div`
    
`;

const TabPanel = styled.div<TabPanelProps>`
    width: ${({ width }) => `${width}%`};
    height: ${({ height }) => `${height}%`};
    font-size: ${({ fontSize }) => `${fontSize*0.24}px`};
`;

function App() {
  const appContext: {state: AppState, setDbPath: any, dispatch: any, setFontSize: any, fontSize: number} = useContext(AppContext);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const appRef = useRef<number>(0);
  const {panelSetting, version, updateVersion, panelLocation, setPanelLocation} = useSettings();
  const { palette } = useThemeColors();
  
  const contentLengthRef = useRef<number>(0);
  const downloadedRef = useRef<number>(0);
  const downloadingRef = useRef<boolean>(false);
  const baniId = useContextSelector(ShabadContext, (ctx) => ctx.state.baniId);

  const speech = useSpeech();
  const speechStarted = speech.started;

  const calculateFontSize = () => {
    const viewPortHeight = window.innerHeight;

    let newPortion = 10;
    if (viewPortHeight > 800) {
      newPortion = 12;
    }

    const newFontSize = Math.max(12, Math.min(viewPortHeight / newPortion, 150));
    appContext.setFontSize(newFontSize);
  };

  useEffect(() => {
    calculateFontSize();

    const handleResize = () => {
      calculateFontSize();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    appRef.current++;
  }, []);

  useShabadNavigation();
  const { mouseVisible, showTitleBar } = useAutoHideCursor({ delay: 5, titleBarThreshold: 100 });

  useEffect(() => {
    const downloadDB = async () => {
      const channel = new Channel<DownloadEvent>((event) => {
        switch (event.event) {
          case "started":
            downloadingRef.current = true;
            contentLengthRef.current = event.data.content_length;
            downloadedRef.current = 0;
            break;
          case "progress":
            downloadedRef.current += event.data.chunk_length;

            const progressPercent =
              (downloadedRef.current / contentLengthRef.current) * 100;

            setProgress(progressPercent);
            break;
          case "finished":
            downloadingRef.current = false;
            setProgress(100);
            setReady(true);
            break;
          
          case "skipped":
            if (version !== appVersion) {
              DB.schemaExists = false;
              updateVersion(appVersion);
            } else {
              DB.schemaExists = true;
            }

            setReady(true);
            break;
        }
      });

      try {
        const path = await invoke<string>("download_sqlite_file_with_channel", {
          url: "https://github.com/shabados/database/releases/download/4.8.7/database.sqlite",
          onEvent: channel,
        });

        if (path) {
          appContext.setDbPath(path);
          DB.setDbPath(path);

          // trigger instance
          await DB.getInstance();
        }
      } catch (err) {
        console.error("Download error:", err);
      }
    };

    downloadDB();
  }, []);

  useEffect(() => {
      const onESC = (ev: KeyboardEvent) => {
        if (ev.ctrlKey) {
          ev.preventDefault();
        }

        if (ev.key == "Control" || ev.key == "F5") {
            ev.preventDefault();
            return;
        }

          switch (ev.key) {
              case "h":
              case "H":
                  if (ev.ctrlKey) {
                    appContext.dispatch({
                        type: TOGGLE_PANEL,
                    })
                    ev.preventDefault();
                  }
                  break;
              
              case "l":
                  if (ev.ctrlKey) {
                    setPanelLocation('left');
                    ev.preventDefault();
                  }
                  break;
              
              case "r":
                  if (ev.ctrlKey) {
                    setPanelLocation('right');
                    ev.preventDefault();
                  }
                  break;
                
              case "/":
                if (ev.ctrlKey) {
                    appContext.dispatch({
                        type: SET_APP_PAGE,
                        payload: {
                            page: "search",
                            show_panel: true,
                        },
                    });
                    ev.preventDefault();
                }
                break;

              case "Tab":
                  if (ev.ctrlKey) {
                      if (appContext.state.page === PAGE_ANNOUNCEMENT) {
                          appContext.dispatch({
                              type: SET_APP_PAGE,
                              payload: {
                                  page: appContext.state.prev_page,
                                  show_panel: appContext.state.prev_show_panel,
                              }
                          });
                          break;
                      }

                      appContext.dispatch({
                          type: SET_APP_PAGE,
                          payload: {
                              page: PAGE_ANNOUNCEMENT,
                              show_panel: false,
                          }
                      });
                  }
                  break;
          }
      };

      window.addEventListener("keydown", onESC);

      return () => {
        window.removeEventListener("keydown", onESC);
      };
  }, [appContext.state]);

  const togglePanel = () => {
    appContext.dispatch({
      type: TOGGLE_PANEL
    });
  }

  if (downloadingRef.current === true) {
    return <LoadingScreen progress={progress} />;
  }

  if (!ready) {
    return <LoadingScreen />;
  }

  return (
    <AppPanel className="w-full h-full"
      style={ { background: palette.background, cursor: mouseVisible ? "default" : "none" }}
    >
          {mouseVisible && showTitleBar && (
            <div
              id="header"
              className="fixed top-0 left-0 w-full h-10 bg-white border-2 border-gray-800 text-gray-800 flex justify-between items-center px-4 z-50 select-none"
            >
              <div className="ml-4 text-lg">Gurbani Explorer - SinghECloud.com</div>
              <div>
                <button onClick={minimizeWindow} className="border-2 p-1 m-1 border-gray-800 mx-2 hover:text-black">
                  <FaWindowMinimize />
                </button>
                <button onClick={closeWindow} className="border-2 p-1 m-1 border-gray-800 mx-2 hover:text-red-500">
                  <FaTimes />
                </button>
              </div>
            </div>
          )}
        {
            appContext.state.page === PAGE_ANNOUNCEMENT &&
            <AnnouncementDisplay />
        }

        {speechStarted && baniId === 13
            ? <BaniDisplay />
            : <ShabadDisplay />
        }
          {appContext.state.show_panel &&
            <TabPanel
              className={`absolute flex flex-col w-1/3 h-1/3 bottom-0 overflow-hidden shadow-2xl border-2 border-gray-300 ${panelLocation === 'right' ? 'right-0' : 'left-0'}`}
              width={panelSetting.panelWidth}
              height={panelSetting.panelHeight}
              fontSize={appContext.fontSize}
            >
              <div className="flex-none h-8 bg-gray-200 flex items-center justify-between">
                <div className="flex" style={{ width: '90%' }}>

                  <div className="ml-2 flex-shrink-0 p-2">
                    {speech.started ? (
                      <button
                        onClick={() => speech.setStarted(false)}
                      >
                      <FaStopCircle
                        className="text-red-700"
                        title="Stop Bani Pilot"
                      />
                      </button>
                    ) : (
                      <button
                        onClick={() => speech.setStarted(true)}
                      >
                      <FaPlayCircle
                        title="Start Bani Pilot"
                      />
                      </button>
                    )}
                  </div>

                  <div className="ml-4 flex-1 overflow-hidden mt-3 text-gray-600 text-sm">
                    {speech.nonFinalText}
                    &nbsp;
                  </div>

                </div>
                <FaWindowMinimize
                  className="text-gray-600 cursor-pointer mb-3 mr-4"
                  onClick={togglePanel}
                />
              </div>
              <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
                {appContext.state.page === "shabad" && <ShabadPanel />}
                {appContext.state.page === "search" && <SearchPanel />}
                {appContext.state.page === "settings" && <SettingPanel />}
                {appContext.state.page === "recent" && <RecentPanel />}
                {appContext.state.page === "bani" && <BaniPanel />}
                {appContext.state.page === PAGE_ANNOUNCEMENT && <AnnouncementPanel />}
              </div>
              <div className="flex-none">
                <TabIcons />
              </div>
            </TabPanel>
          }
          {!appContext.state.show_panel && mouseVisible &&
            <div className="absolute right-4 bottom-4 p-3 border-2 border-gray-300 rounded-2xl bg-white">
            <FaWindowMaximize
              className=" text-gray-800 cursor-pointer"
              onClick={togglePanel}
            />
            </div>
          }
    </AppPanel>
  );
}

export default App;
