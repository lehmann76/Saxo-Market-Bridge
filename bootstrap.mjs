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


// SAXO_SAFE_DIAGNOSTICS_ROUTE_V1
const diagnosticsRoute = `
import { NextResponse } from "next/server"
import { getValidAccessToken } from "@/lib/saxo/tokens"
import { SAXO_API_BASE } from "@/lib/saxo/config"

export const dynamic = "force-dynamic"

async function safeGet(path: string) {
  const token = await getValidAccessToken()
  if (!token) return { ok: false, status: 401, data: null }
  const res = await fetch(\`\${SAXO_API_BASE}\${path}\`, {
    headers: { Authorization: \`Bearer \${token}\`, Accept: "application/json" },
    cache: "no-store",
  })
  let data: any = null
  try { data = await res.json() } catch {}
  return { ok: res.ok, status: res.status, data }
}

export async function GET() {
  const user = await safeGet("/port/v1/users/me")
  const ent = await safeGet("/port/v1/users/me/entitlements?EntitlementFieldSet=Default")

  const exchanges = Array.isArray(ent.data?.Data)
    ? ent.data.Data.map((x: any) => ({
        exchangeId: x.ExchangeId ?? null,
        entitlements: x.Entitlements ?? [],
      }))
    : []

  return NextResponse.json({
    diagnostic: "Saxo LIVE market-data access",
    userEndpointStatus: user.status,
    marketDataViaOpenApiTermsAccepted: user.data?.MarketDataViaOpenApiTermsAccepted ?? null,
    legalAssetTypes: user.data?.LegalAssetTypes ?? [],
    entitlementEndpointStatus: ent.status,
    exchanges,
    note: "No tokens, account IDs, client IDs, user IDs, names, or secrets are returned by this endpoint.",
  })
}
`
mkdirSync("app/api/diagnostics/saxo", { recursive: true })
writeFileSync("app/api/diagnostics/saxo/route.ts", diagnosticsRoute, "utf8")
