import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionProvider } from "./lib/session";
import { LangProvider } from "./i18n";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </LangProvider>
  </StrictMode>,
);
