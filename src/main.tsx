import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import { AppProvider } from "./context/AppContext";
import { AppContent } from "./App";
import "./styles.css";
import "./redesign.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AppProvider>
      <AppContent />
    </AppProvider>
  </React.StrictMode>
);
