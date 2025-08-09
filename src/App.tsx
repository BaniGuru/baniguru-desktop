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

const Tabs = styled.div``;

// Define the type for DownloadEvent from backend
type DownloadEvent =
  | { event: "started"; data: { url: string; download_id: number; content_length: number } }
  | { event: "progress"; data: { download_id: number; chunk_length: any } }
  | { event: "finished"; data: { download_id: number } }
  | { event: "skipped"; data: {db_path: string; } } ;

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const {state, dispatch, dbPath, setDbPath} = useContext(AppContext);
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
      // Set up channel to receive DownloadEvent
      const channel = new Channel<DownloadEvent>((event) => {
        switch (event.event) {
          case "started":
            console.log(event.event);
            downloadingRef.current = true;
            contentLengthRef.current = event.data.content_length;
            downloadedRef.current = 0;
            console.log("Download started:", event.data);
            break;
          case "progress":
            downloadedRef.current += event.data.chunk_length;

            const progressPercent =
              (downloadedRef.current / contentLengthRef.current) * 100;

            setProgress(progressPercent);
            break;
          case "finished":
            downloadingRef.current = false;
            console.log(event.event);
            console.log("Download finished:", event.data);
            setProgress(100);
            setReady(true);
            break;
          
          case "skipped":
            console.log(event.event);
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
    <div className="container">
      <ShabadProvider>
        <SearchProvider>
          <ShabadDisplay />
          {
            state.page === "shabad" &&
            <Tabs>
              <ShabadPanel />
            </Tabs>
          }

          {
            state.page === "search" &&
            <Tabs>
              <SearchPanel />
            </Tabs>
          }
        </SearchProvider>
      </ShabadProvider>
    </div>
  );
}

export default App;
