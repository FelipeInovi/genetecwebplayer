import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/render/locales/i18n";
import "@/styles.css";
import App from "@/render/App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
