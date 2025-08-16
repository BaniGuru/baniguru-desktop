import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./theme.css";
import { SearchProvider } from "./state/providers/SearchProvider";
import { AppProvider } from "./state/providers/AppProvider";
import * as React from "react";
import { ShabadProvider } from "./state/providers/ShabadProvider";
import { SettingProvider } from "./state/providers/SettingContext";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
        <SearchProvider>
          <ShabadProvider>
            <SettingProvider>
              <App />
            </SettingProvider>
          </ShabadProvider>
        </SearchProvider>
    </AppProvider>
  </React.StrictMode>
);
