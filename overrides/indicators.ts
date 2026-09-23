import type { Candle } from "./client"

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number }

const partCache = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string): Intl.DateTimeFormat {
  let f = partCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
    partCache.set(tz, f)
  }
  return f
}
function zonedParts(epochMs: number, tz: string): ZonedParts {
  const parts = formatter(tz).formatToParts(new Date(epochMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  let hour = get("hour")
  if (hour === 24) hour = 0
  return { year: get("year"), month: get("month"), day: get("day"), hour, minute: get("minute") }
}
function dayKey(p: ZonedParts): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}
function minutesOfDay(p: ZonedParts): number { return p.hour * 60 + p.minute }
function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number)
  return h * 60 + m
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null
  const k = 2 / (period + 1)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < values.length; i++) prev = values[i] * k + prev * (1 - k)
  return prev
}
export function emaOnCloses(candles: Candle[], period: number): number | null {
  return ema(candles.map((c) => c.close), period)
}

export type Range = { high: number; low: number; date: string } | null

export function openingRange(candles: Candle[], tz: string, start: string, end: string): Range {
  const startMin = parseHHMM(start)
  const endMin = parseHHMM(end)
  const byDay = new Map<string, Candle[]>()
  for (const c of candles) {
    const p = zonedParts(c.time, tz)
    const mod = minutesOfDay(p)
    if (mod >= startMin && mod < endMin) {
      const key = dayKey(p)
      const arr = byDay.get(key) ?? []
      arr.push(c)
      byDay.set(key, arr)
    }
  }
  if (byDay.size === 0) return null
  const latestDay = [...byDay.keys()].sort().pop() as string
  const bars = byDay.get(latestDay) as Candle[]
  return { high: Math.max(...bars.map(c => c.high)), low: Math.min(...bars.map(c => c.low)), date: latestDay }
}
export function sessionRange(candles: Candle[], tz: string, start: string, end: string): Range {
  return openingRange(candles, tz, start, end)
}

// Previous available trading day from intraday candles in the instrument session timezone.
// Using M5 bars avoids UTC daily-bar timestamps shifting Nasdaq to the prior calendar date.
export function previousTradingDayRange(candles: Candle[], tz: string): Range {
  const byDay = new Map<string, Candle[]>()
  for (const c of candles) {
    const key = dayKey(zonedParts(c.time, tz))
    const arr = byDay.get(key) ?? []
    arr.push(c)
    byDay.set(key, arr)
  }
  const days = [...byDay.keys()].sort()
  if (days.length < 2) return null
  const prevDay = days[days.length - 2]
  const bars = byDay.get(prevDay) as Candle[]
  return { high: Math.max(...bars.map(c => c.high)), low: Math.min(...bars.map(c => c.low)), date: prevDay }
}
