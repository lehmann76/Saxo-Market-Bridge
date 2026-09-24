import { gunzipSync } from "node:zlib"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const payload = [1, 2, 3, 4]
  .map((n) => readFileSync(`payload/part${n}.txt`, "utf8").trim())
  .join("")

const files = JSON.parse(
  gunzipSync(Buffer.from(payload, "base64")).toString("utf8"),
)

files["lib/saxo/market-data.ts"] = files["lib/saxo/market-data.ts"].replace("previousDayRange(daily, def.sessionTimezone)", "previousDayRange(m5, def.sessionTimezone)")

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

async function one(uic: number, timeZone: string, orbStart: string, orbEnd: string) {
  const [m5, h1, d1] = await Promise.all([\n    getChart("CfdOnIndex", uic, 5, 1200),\n    getChart("CfdOnIndex", uic, 60, 1200),\n    getChart("CfdOnIndex", uic, 1440, 15),\n  ])
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false })
  const local = (ms: number) => {
    const p: any = {}; for (const x of fmt.formatToParts(new Date(ms))) p[x.type]=x.value
    return { date: p.year+"-"+p.month+"-"+p.day, hm: (p.hour === "24" ? "00" : p.hour)+":"+p.minute }
  }
  const calcEma = (bars: any[], period: number) => {
    if (bars.length < period) return null
    const vals = bars.map((b:any) => b.close)
    const k = 2 / (period + 1)
    let e = vals.slice(0, period).reduce((a:number,b:number)=>a+b,0) / period
    for (let i=period;i<vals.length;i++) e = vals[i]*k + e*(1-k)
    return e
  }
  const emaCheck = {
    m5: { ema8: calcEma(m5,8), ema21: calcEma(m5,21), lastClose: m5[m5.length-1]?.close ?? null, lastTime: m5.length ? new Date(m5[m5.length-1].time).toISOString() : null },
    h1: { ema8: calcEma(h1,8), ema21: calcEma(h1,21), lastClose: h1[h1.length-1]?.close ?? null, lastTime: h1.length ? new Date(h1[h1.length-1].time).toISOString() : null },
  }
  const latestDate = local(m5[m5.length-1].time).date
  const orbBars = m5.filter((b:any) => { const x=local(b.time); return x.date===latestDate && x.hm>=orbStart && x.hm<orbEnd })
    .map((b:any) => ({ localTime: local(b.time).hm, time:new Date(b.time).toISOString(), high:b.high, low:b.low, close:b.close }))
  return {
    m5ByLocalDate: groupDays(m5, timeZone),\n    emaCheck,\n    orbCheck: { date: latestDate, window: orbStart+"-"+orbEnd+" "+timeZone, bars: orbBars,
      high: orbBars.length ? Math.max(...orbBars.map((b:any)=>b.high)) : null,
      low: orbBars.length ? Math.min(...orbBars.map((b:any)=>b.low)) : null },
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
      dax: await one(4910, "Europe/Copenhagen", "09:00", "09:15"),
      nasdaq: await one(4912, "America/New_York", "09:30", "09:45"),
      note: "Only OHLC/time summaries are returned. No account data, tokens or secrets.",
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 })
  }
}
`
mkdirSync("app/api/diagnostics/market-bars", { recursive: true })
writeFileSync("app/api/diagnostics/market-bars/route.ts", marketBarsDiagnosticRoute, "utf8")


const bridgeSnapshotRoute = `
import { NextResponse } from "next/server"
import { getAllMarketData } from "@/lib/saxo/market-data"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const expected = process.env.BRIDGE_API_KEY
    if (!expected) {
      return NextResponse.json({ error: "Bridge API key is not configured" }, { status: 503 })
    }
    const supplied = request.headers.get("x-api-key")
    if (!supplied || supplied !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const markets = await getAllMarketData()
    return NextResponse.json(
      {
        source: "Saxo LIVE OpenAPI",
        mode: "read-only",
        asOf: new Date().toISOString(),
        markets,
        note: "Derived market snapshot only. No account data, orders, tokens or secrets.",
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    )
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
`
mkdirSync("app/api/bridge/snapshot", { recursive: true })
writeFileSync("app/api/bridge/snapshot/route.ts", bridgeSnapshotRoute, "utf8")
