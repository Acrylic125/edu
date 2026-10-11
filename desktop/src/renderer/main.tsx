import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme/theme-provider"
import { App } from "./workspace"
import { initializeWorkspace } from "./store"
import "./styles.css"

void initializeWorkspace()
const root = document.getElementById("root")
if (!root) throw new Error("Missing app root")
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
