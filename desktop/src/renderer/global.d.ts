import type { DesktopBridge } from "../shared/contracts"

declare global {
  interface Window {
    edu?: DesktopBridge
  }
}
