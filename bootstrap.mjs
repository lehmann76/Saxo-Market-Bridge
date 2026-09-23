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


// SAXO_SAFE_MARKET_BARS_DIAGNOSTIC_V1
const marketBarsDiagnosticRoute = `
import { NextResponse } from "next/server"
import { getChart } from "@/lib/saxo/client"

export const dynamic = "force-dynamic"

function localDate(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms))
  const v: Record<string,string> = {}
  for (const p of parts) v[p.type] = p.value
  return \`\${v.year}-\${v.month}-\${v.day}\`
}

function groupDays(bars: any[], timeZone: string) {
  const days = new Map<string, { high: number, low: number, count: number, first: string, last: string }>()
  for (const b of bars) {
    const d = localDate(b.time, timeZone)
    const cur = days.get(d)
    if (!cur) {
      days.set(d, { high: b.high, low: b.low, count: 1, first: new Date(b.time).toISOString(), last: new Date(b.time).toISOString() })
    } else {
      cur.high = Math.max(cur.high, b.high)
      cur.low = Math.min(cur.low, b.low)
      cur.count++
      cur.last = new Date(b.time).toISOString()
    }
  }
  return [...days.entries()].map(([date, x]) => ({ date, ...x })).slice(-7)
}

async function one(uic: number, timeZone: string) {
  const [m5, d1] = await Promise.all([
    getChart("CfdOnIndex", uic, 5, 1200),
    getChart("CfdOnIndex", uic, 1440, 15),
  ])
  return {
    m5ByLocalDate: groupDays(m5, timeZone),
    dailyBars: d1.slice(-10).map((b: any) => ({
      time: new Date(b.time).toISOString(),
      open: b.open, high: b.high, low: b.low, close: b.close,
    })),
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      diagnostic: "Safe market-bar/session check",
      dax: await one(4910, "Europe/Copenhagen"),
      nasdaq: await one(4912, "America/New_York"),
      note: "Only OHLC/time summaries are returned. No account data, tokens or secrets.",
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 })
  }
}
`
mkdirSync("app/api/diagnostics/market-bars", { recursive: true })
writeFileSync("app/api/diagnostics/market-bars/route.ts", marketBarsDiagnosticRoute, "utf8")
