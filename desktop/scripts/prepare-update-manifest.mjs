import { createHash } from "node:crypto"
import { copyFile, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

export async function prepareUpdateManifest(source, destination, version) {
  const name = `EdU-${version}-arm64-mac.zip`
  const zip = await readFile(join(source, name))
  const sha512 = createHash("sha512").update(zip).digest("base64")
  // macOS updates use the ZIP; the DMG is stapled after builder generates its metadata.
  const manifest = {
    version,
    files: [{ url: basename(name), sha512, size: zip.length }],
    path: basename(name),
    sha512,
    releaseDate: new Date().toISOString(),
  }
  await copyFile(join(source, `${name}.blockmap`), join(destination, `${name}.blockmap`))
  // JSON is valid YAML, and keeps filenames and version strings escaped correctly.
  await writeFile(join(destination, "latest-mac.yml"), `${JSON.stringify(manifest, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination, version] = process.argv.slice(2)
  if (!source || !destination || !version) throw new Error("Expected source, destination, and version.")
  await prepareUpdateManifest(source, destination, version)
}
