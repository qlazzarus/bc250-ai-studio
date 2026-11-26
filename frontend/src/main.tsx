import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

/**
 * UIX06A: real URLs, no hash.
 *
 * AI Studio is served at the origin root and Caddy already falls back to `index.html` for any
 * unknown path, so `BrowserRouter` with no `basename` is the whole configuration. The router
 * lives here rather than inside `App` so that `App` keeps owning the session state it already
 * owned — the router wraps it, it does not replace it.
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
