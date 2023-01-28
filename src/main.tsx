import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./style.css";
import { SearchProvider } from "./state/providers/SearchProvider";
import { AppProvider } from "./state/providers/AppProvider";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
        <SearchProvider>
            <App />
        </SearchProvider>
    </AppProvider>
  </React.StrictMode>
);
