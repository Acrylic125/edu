import { initializeAppUpdates } from "./app-updates"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@edu/ui/theme"
import { App } from "./workspace"
import { initializeWorkspace } from "./store"
import "./styles.css"

void initializeWorkspace()
void initializeAppUpdates()
const root = document.getElementById("root")
if (!root) throw new Error("Missing app root")
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
