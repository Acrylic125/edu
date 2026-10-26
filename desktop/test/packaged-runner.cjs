// Electron's patched fs treats ASAR archives as directories; copy the archive bytes with original-fs.
const { constants, promises: { access, copyFile, cp, mkdtemp, rm, writeFile } } = require("original-fs")
const { tmpdir } = require("node:os")
const { join } = require("node:path")
const { app, utilityProcess } = require("electron")

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "edu-packaged-runner-"))
  app.setPath("userData", join(directory, "profile"))
  let child
  let stopped
  let exitCode = 0
  try {
    const source = process.argv[2]
    const archive = join(directory, "app.asar")
    // Loading outside the checkout prevents missing packaged dependencies from resolving in development node_modules.
    await copyFile(source, archive, constants.COPYFILE_FICLONE)
    try {
      await access(`${source}.unpacked`)
      await cp(`${source}.unpacked`, `${archive}.unpacked`, { recursive: true, mode: constants.COPYFILE_FICLONE })
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    const bootstrap = join(directory, "bootstrap.cjs")
    await writeFile(bootstrap, `
const { join, dirname } = require("node:path");
async function start() {
  require(process.argv[2]);
  const archive = process.argv[3];
  const { createWorker, OEM } = require(join(archive, "node_modules/tesseract.js"));
  const { createCanvas } = require(join(archive, "node_modules/@napi-rs/canvas"));
  const canvas = createCanvas(1000, 200);
  const context = canvas.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 1000, 200);
  context.fillStyle = "black";
  context.font = "48px sans-serif";
  context.fillText("6.1 Vector spaces", 40, 100);
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    langPath: join(archive + ".unpacked", "node_modules/@tesseract.js-data/eng/4.0.0_best_int"),
    workerPath: join(archive + ".unpacked", "node_modules/tesseract.js/src/worker-script/node/index.js"),
    cachePath: dirname(archive)
  });
  try {
    const result = await worker.recognize(canvas.toBuffer("image/png"));
    if (!result.data.text.includes("Vector spaces")) throw new Error("Packaged OCR did not recognize the fixture");
  } finally { await worker.terminate(); }
  process.parentPort.postMessage("packaged-runner-ready");
}
void start().catch((error) => { console.error(error); process.exit(1); });
`)
    await app.whenReady()
    child = utilityProcess.fork(bootstrap, [join(archive, "out", "main", "worker.js"), archive], {
      serviceName: "EdU packaged runner test",
      stdio: "pipe",
    })
    stopped = new Promise((resolve) => child.once("exit", resolve))
    await new Promise((resolve, reject) => {
      let stderr = ""
      const timer = setTimeout(() => reject(new Error("Packaged runner did not complete startup.")), 20_000)
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16_000) })
      child.on("message", (message) => {
        if (message !== "packaged-runner-ready") return
        clearTimeout(timer)
        resolve()
      })
      child.on("exit", (code) => {
        clearTimeout(timer)
        reject(new Error(`Packaged runner exited (${code}) during startup.\n${stderr}`))
      })
    })
    console.log("PASS: packaged runner and bundled OCR work without development dependencies, language downloads, or a model request")
  } catch (error) {
    console.error(error)
    exitCode = 1
  } finally {
    child?.kill()
    await stopped
    await rm(directory, { recursive: true, force: true })
    app.exit(exitCode)
  }
}

void main().catch((error) => { console.error(error); app.exit(1) })
