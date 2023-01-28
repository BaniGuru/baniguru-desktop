import { createRef, useContext, useEffect, useRef, useState } from "react";
import reactLogo from "./assets/react.svg";
import { invoke  } from "@tauri-apps/api/tauri";
import { BaseDirectory, appDataDir } from "@tauri-apps/api/path";
import "./App.css";
import Database from "tauri-plugin-sql-api";
import styled from "styled-components";
import SearchPanel from "./components/SearchPanel";
import { SearchContext, SearchProvider } from "./state/providers/SearchProvider";
import ShabadDisplay from "./components/ShabadDisplay";
import { ShabadProvider } from "./state/providers/ShabadProvider";
import ShabadPanel from "./components/ShabadPanel";
import { AppContext } from "./state/providers/AppProvider";
import { SET_APP_PAGE } from "./state/ActionTypes";

const Tabs = styled.div``;

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");
  const state = useContext(AppContext).state;
  const dispatch = useContext(AppContext).dispatch;

  const appRef = useRef<number>(0);

    useEffect(() => {
        appRef.current++;
    })

    console.log("app ref: ", appRef.current);

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/v1/guides/features/command
    setGreetMsg(await invoke("greet", { name }));
  }

  return (
    <div className="container">
        <ShabadProvider>
            <ShabadDisplay />
            {
                state.page == 'shabad' && 
                <Tabs>
                    <ShabadPanel />
                </Tabs>
            }
        </ShabadProvider>
        {
            state.page == 'search' && 
            <Tabs>
                <SearchPanel />
            </Tabs>
        }
    </div>
  );
}

export default App;