import { useContext, useEffect, useRef, useState } from "react";
import "./App.css";
import styled from "styled-components";
import SearchPanel from "./components/SearchPanel";
import { SearchProvider } from "./state/providers/SearchProvider";
import ShabadDisplay from "./components/ShabadDisplay";
import { ShabadProvider } from "./state/providers/ShabadProvider";
import ShabadPanel from "./components/ShabadPanel";
import { AppContext } from "./state/providers/AppProvider";
import { Channel, invoke } from "@tauri-apps/api/core";
import { DB } from "./utils/DB";
import LoadingScreen from "./ui/LoadingScreen";
import TabIcons from "./ui/TabIcons";

type DownloadEvent =
  | { event: "started"; data: { url: string; download_id: number; content_length: number } }
  | { event: "progress"; data: { download_id: number; chunk_length: any } }
  | { event: "finished"; data: { download_id: number } }
  | { event: "skipped"; data: {db_path: string; } } ;

function App() {
  const {state, setDbPath} = useContext(AppContext);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const appRef = useRef<number>(0);
  
  const contentLengthRef = useRef<number>(0);
  const downloadedRef = useRef<number>(0);
  const downloadingRef = useRef<boolean>(false);

  useEffect(() => {
    appRef.current++;
  }, []);

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
          setDbPath(path);
          DB.setDbPath(path);
        }
      } catch (err) {
        console.error("Download error:", err);
      }
    };

    downloadDB();
  }, []);

  if (downloadingRef.current === true) {
    return <LoadingScreen progress={progress} />;
  }

  if (!ready) {
    return <LoadingScreen />;
  }

  return (
    <div className="w-full h-full">
      <ShabadProvider>
        <SearchProvider>
          <ShabadDisplay />
          <div className="absolute flex flex-col w-1/3 h-1/3 right-0 bottom-0 overflow-hidden shadow-2xl border-2 border-gray-200">
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
              {state.page === "shabad" && <ShabadPanel />}
              {state.page === "search" && <SearchPanel />}
            </div>
            <div className="flex-none">
              <TabIcons />
            </div>
          </div>
        </SearchProvider>
      </ShabadProvider>
    </div>
  );
}

export default App;
