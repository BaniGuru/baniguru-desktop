import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./theme.css";
import { SearchProvider } from "./state/providers/SearchProvider";
import { AppProvider } from "./state/providers/AppProvider";
import * as React from "react";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
        <SearchProvider>
            <App />
        </SearchProvider>
    </AppProvider>
  </React.StrictMode>
);
