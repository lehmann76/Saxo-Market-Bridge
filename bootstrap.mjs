import { gunzipSync } from "node:zlib"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const payload = [1, 2, 3, 4]
  .map((n) => readFileSync(`payload/part${n}.txt`, "utf8").trim())
  .join("")

const files = JSON.parse(
  gunzipSync(Buffer.from(payload, "base64")).toString("utf8"),
)

for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf8")
}

console.log(`Bootstrapped ${Object.keys(files).length} Saxo Market Bridge source files`)
