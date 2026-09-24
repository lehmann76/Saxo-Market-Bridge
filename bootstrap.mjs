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

// Strategy convention: Asian Range is fixed at 02:00–08:00 Europe/Copenhagen.
// Only alter lines explicitly related to the Asian range to avoid changing other midnight-based logic.
files["lib/saxo/market-data.ts"] = files["lib/saxo/market-data.ts"]
  .replaceAll('"00:00", "08:00"', '"02:00", "08:00"')
  .replaceAll('"00:00–08:00', '"02:00–08:00')
  .replaceAll("'00:00', '08:00'", "'02:00', '08:00'")
  .replaceAll("'00:00–08:00", "'02:00–08:00")

// Asian range strategy convention for both DAX and Nasdaq.
files["lib/saxo/instruments.ts"] = files["lib/saxo/instruments.ts"].replaceAll(
  'asianStart: "00:00"',
  'asianStart: "02:00"',
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
import { getChart } from "@/lib/saxo/client"

export const dynamic = "force-dynamic"

function median(values: number[]) {
  if (!values.length) return null
  const x = [...values].sort((a, b) => a - b)
  const mid = Math.floor(x.length / 2)
  return x.length % 2 ? x[mid] : (x[mid - 1] + x[mid]) / 2
}

async function deriveTechnicalContext(m: any) {
  const price = m.lastClose
  const h1 = m.ema?.h1
  const m5 = m.ema?.m5
  const bars = await getChart(m.assetType, m.uic, 5, 60)
  const recent = bars.slice(-3)
  const last = bars[bars.length - 1] ?? null
  const prior = bars.slice(-21, -1)

  const h1Direction = h1?.ema8 > h1?.ema21 ? "bullish" : h1?.ema8 < h1?.ema21 ? "bearish" : "flat"
  const m5Direction = m5?.ema8 > m5?.ema21 ? "bullish" : m5?.ema8 < m5?.ema21 ? "bearish" : "flat"
  const orbState = price > m.orb?.high ? "above" : price < m.orb?.low ? "below" : "inside"
  const asianState = price > m.asianSession?.high ? "above" : price < m.asianSession?.low ? "below" : "inside"
  const previousDayState = price > m.previousDay?.high ? "above" : price < m.previousDay?.low ? "below" : "inside"

  const ranges = prior.map((b: any) => Math.max(0, b.high - b.low)).filter((x: number) => x > 0)
  const medianRange = median(ranges)
  const lastRange = last ? Math.max(0, last.high - last.low) : null
  const lastBody = last ? Math.abs(last.close - last.open) : null
  const rangeRatio = lastRange != null && medianRange ? lastRange / medianRange : null
  const bodyRatio = lastRange ? lastBody / lastRange : null

  const closesAboveOrb = recent.filter((b: any) => b.close > m.orb?.high).length
  const closesBelowOrb = recent.filter((b: any) => b.close < m.orb?.low).length
  const bullishDisplacement = orbState === "above" && (rangeRatio ?? 0) >= 1.5 && (bodyRatio ?? 0) >= 0.6 && last?.close > last?.open
  const bearishDisplacement = orbState === "below" && (rangeRatio ?? 0) >= 1.5 && (bodyRatio ?? 0) >= 0.6 && last?.close < last?.open
  const bullishAcceptance = orbState === "above" && (closesAboveOrb >= 2 || bullishDisplacement)
  const bearishAcceptance = orbState === "below" && (closesBelowOrb >= 2 || bearishDisplacement)

  let score = 0
  score += h1Direction === "bullish" ? 2 : h1Direction === "bearish" ? -2 : 0
  score += m5Direction === "bullish" ? 1 : m5Direction === "bearish" ? -1 : 0
  score += orbState === "above" ? 2 : orbState === "below" ? -2 : 0
  score += asianState === "above" ? 1 : asianState === "below" ? -1 : 0
  score += previousDayState === "above" ? 1 : previousDayState === "below" ? -1 : 0
  score += bullishAcceptance ? 1 : bearishAcceptance ? -1 : 0

  const longAligned = h1Direction === "bullish" && orbState === "above" && (m5Direction === "bullish" || bullishAcceptance)
  const shortAligned = h1Direction === "bearish" && orbState === "below" && (m5Direction === "bearish" || bearishAcceptance)

  const rawLevels = [
    ["ORB high", m.orb?.high], ["ORB low", m.orb?.low],
    ["Asian high", m.asianSession?.high], ["Asian low", m.asianSession?.low],
    ["PDH", m.previousDay?.high], ["PDL", m.previousDay?.low],
  ].filter((x: any[]) => typeof x[1] === "number")
  const supports = rawLevels.filter((x: any[]) => x[1] < price).sort((a: any[], b: any[]) => b[1] - a[1])
  const resistances = rawLevels.filter((x: any[]) => x[1] > price).sort((a: any[], b: any[]) => a[1] - b[1])
  const ageMinutes = m.latestTimestamp ? Math.max(0, (Date.now() - new Date(m.latestTimestamp).getTime()) / 60000) : null

  return {
    h1Direction, m5Direction, orbState, asianState, previousDayState, score,
    technicalSetup: longAligned && score >= 4 ? "LONG_CANDIDATE" : shortAligned && score <= -4 ? "SHORT_CANDIDATE" : "WAIT",
    breakout: {
      closesAboveOrbLast3: closesAboveOrb,
      closesBelowOrbLast3: closesBelowOrb,
      rangeRatioVsMedian20: rangeRatio,
      bodyRatio,
      bullishDisplacement, bearishDisplacement,
      bullishAcceptance, bearishAcceptance,
    },
    freshness: {
      latestTimestamp: m.latestTimestamp,
      ageMinutes,
      status: ageMinutes == null ? "unknown" : ageMinutes <= 10 ? "fresh" : ageMinutes <= 30 ? "aging" : "stale",
    },
    nearestSupport: supports[0] ? { name: supports[0][0], price: supports[0][1], distance: price - supports[0][1] } : null,
    nearestResistance: resistances[0] ? { name: resistances[0][0], price: resistances[0][1], distance: resistances[0][1] - price } : null,
  }
}

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
    const rawMarkets = await getAllMarketData()
    const markets = await Promise.all(rawMarkets.map(async (m: any) => ({ ...m, technical: await deriveTechnicalContext(m) })))
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
