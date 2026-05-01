import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const LEGACY_HOST = "panoptesai.net";
const CANONICAL_HOST = "www.panoptesai.net";

function redirectLegacyHost(): boolean {
  if (typeof window === "undefined" || window.location.hostname !== LEGACY_HOST) {
    return false;
  }

  const canonicalUrl = new URL(window.location.href);
  canonicalUrl.hostname = CANONICAL_HOST;
  window.location.replace(canonicalUrl.toString());
  return true;
}

if (!redirectLegacyHost()) {
  createRoot(document.getElementById("root")!).render(<App />);
}
