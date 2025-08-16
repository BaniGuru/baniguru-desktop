import { useContext, useEffect, useRef, useState } from "react";
import "./App.css";
import SearchPanel from "./components/SearchPanel";
import ShabadDisplay from "./components/ShabadDisplay";
import ShabadPanel from "./components/ShabadPanel";
import { AppContext, AppState } from "./state/providers/AppProvider";
import { Channel, invoke } from "@tauri-apps/api/core";
import { DB } from "./utils/DB";
import LoadingScreen from "./ui/LoadingScreen";
import TabIcons from "./ui/TabIcons";
import { SettingPanel } from "./components/SettingPanel";
import { RecentPanel } from "./components/RecentPanel";
import BaniPanel from "./components/BaniPanel";
import { FaWindowMaximize, FaWindowMinimize } from "react-icons/fa";
import { SET_APP_PAGE, TOGGLE_PANEL } from "./state/ActionTypes";
import useShabadNavigation from "./utils/useShabadNavigation";

type DownloadEvent =
  | { event: "started"; data: { url: string; download_id: number; content_length: number } }
  | { event: "progress"; data: { download_id: number; chunk_length: any } }
  | { event: "finished"; data: { download_id: number } }
  | { event: "skipped"; data: {db_path: string; } } ;

function App() {
  const appContext: {state: AppState, setDbPath: any, dispatch: any} = useContext(AppContext);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const appRef = useRef<number>(0);
  
  const contentLengthRef = useRef<number>(0);
  const downloadedRef = useRef<number>(0);
  const downloadingRef = useRef<boolean>(false);

  useEffect(() => {
    appRef.current++;
  }, []);

  useShabadNavigation();

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
        }
      } catch (err) {
        console.error("Download error:", err);
      }
    };

    downloadDB();
  }, []);

  useEffect(() => {
      const onESC = (ev: KeyboardEvent) => {
          switch (ev.key) {
              case "h":
              case "H":
                  if (ev.ctrlKey) {
                    appContext.dispatch({
                        type: TOGGLE_PANEL,
                    })
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
    <div className="w-full h-full bg-gray-200">
      
          <ShabadDisplay />
          {appContext.state.show_panel &&
            <div className="absolute flex flex-col w-1/3 h-1/3 right-0 bottom-0 overflow-hidden shadow-2xl border-2 border-gray-300">
              <div className="flex-none h-8 bg-gray-200 flex items-center justify-end">
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
              </div>
              <div className="flex-none">
                <TabIcons />
              </div>
            </div>
          }
          {!appContext.state.show_panel &&
            <FaWindowMaximize
              className="absolute right-0 bottom-0 text-gray-600 cursor-pointer mb-3 mr-4"
              onClick={togglePanel}
            />
          }
    </div>
  );
}

export default App;
