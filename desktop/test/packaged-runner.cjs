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
const { createRequire } = require("node:module");
const assert = require("node:assert/strict");
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
  const { getDocumentProxy, extractText, createIsomorphicCanvasFactory, renderPageAsImage } = require(join(archive, "node_modules/unpdf"));
  const canvasModule = require(join(archive, "node_modules/@napi-rs/canvas"));
  const stream = "BT /F1 24 Tf 40 100 Td (Vector spaces) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + stream.length + " >>\\nstream\\n" + stream + "\\nendstream",
  ];
  let document = "%PDF-1.4\\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += (index + 1) + " 0 obj\\n" + object + "\\nendobj\\n";
  }
  const xref = Buffer.byteLength(document);
  document += "xref\\n0 6\\n0000000000 65535 f \\n";
  document += offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n \\n").join("");
  document += "trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n" + xref + "\\n%%EOF\\n";
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(document)), {
    disableFontFace: true,
    CanvasFactory: await createIsomorphicCanvasFactory(() => canvasModule),
  });
  try {
    assert.match((await extractText(pdf, { mergePages: true })).text, /Vector spaces/);
    const image = Buffer.from(await renderPageAsImage(pdf, 1, { canvasImport: () => canvasModule }));
    assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  } finally { await pdf.loadingTask.destroy(); }
  const officePath = require.resolve(join(archive, "node_modules/officeparser"));
  const { OfficeParser, OfficeGenerator } = require(officePath);
  const { zipSync, strToU8 } = createRequire(officePath)("fflate");
  const presentation = zipSync({
    "ppt/presentation.xml": strToU8('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'),
    "ppt/slides/slide1.xml": strToU8('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Vector spaces</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'),
  });
  const parsed = await OfficeParser.parseOffice(Buffer.from(presentation), { fileType: "pptx", ignoreSlideMasters: true });
  assert.match((await OfficeGenerator.generate(parsed, "text")).value, /Vector spaces/);
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
    console.log("PASS: packaged runner, OCR, PDF extraction/rendering, and PPTX extraction work without development dependencies, language downloads, or a model request")
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
