import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./theme.css";
import { SearchProvider } from "./state/providers/SearchProvider";
import { AppProvider } from "./state/providers/AppProvider";
import * as React from "react";
import { ShabadProvider } from "./state/providers/ShabadProvider";
import { SettingProvider } from "./state/providers/SettingContext";
import { BaniProvider } from "./state/providers/BaniProvider";

import * as Sentry from "@sentry/react";
import { AnnouncementProvider } from "./state/providers/AnnouncementProvider";
import { ENV } from "./utils/env";

Sentry.init({
  dsn: ENV.sentryDsn,
  environment: ENV.isDev ? "development" : "production",
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProvider>
      <AnnouncementProvider>
        <SearchProvider>
          <ShabadProvider>
            <SettingProvider>
              <BaniProvider>
                <App />
              </BaniProvider>
            </SettingProvider>
          </ShabadProvider>
        </SearchProvider>
      </AnnouncementProvider>
    </AppProvider>
  </React.StrictMode>
);
