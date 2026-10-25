import { app, BrowserWindow } from "electron"
import { join } from "node:path"

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { partition: "rendering-tests", backgroundThrottling: false },
  })
  window.webContents.on("console-message", (event) => console.log(event.message))
  try {
    await window.loadFile(join(__dirname, "../renderer/index.html"))
    await window.webContents.executeJavaScript("window.renderingTests ?? Promise.reject(new Error('Rendering tests did not start'))")
    app.exit(0)
  } catch (error) {
    console.error(error)
    console.error(await window.webContents.executeJavaScript("document.body.innerText.slice(0, 3000)"))
    app.exit(1)
  }
})
