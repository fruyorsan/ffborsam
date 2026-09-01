export type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number }
export type Signal = "GÜÇLÜ AL" | "AL" | "TUT" | "SAT" | "GÜÇLÜ SAT"

const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback

function ema(values: number[], period: number) {
  if (!values.length) return []
  const k = 2 / (period + 1)
  const result = [values[0]]
  for (let i = 1; i < values.length; i++) result.push(values[i] * k + result[i - 1] * (1 - k))
  return result
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50
  const changes = values.slice(1).map((v, i) => v - values[i])
  let gains = avg(changes.slice(0, period).map(v => Math.max(v, 0)))
  let losses = avg(changes.slice(0, period).map(v => Math.max(-v, 0)))
  for (const change of changes.slice(period)) {
    gains = (gains * (period - 1) + Math.max(change, 0)) / period
    losses = (losses * (period - 1) + Math.max(-change, 0)) / period
  }
  if (losses === 0) return gains === 0 ? 50 : 100
  return finite(100 - 100 / (1 + gains / losses), 50)
}

function atr(candles: Candle[], period = 14) {
  if (candles.length < 2) return 0
  const ranges = candles.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close)))
  return avg(ranges.slice(-period))
}

function stochastic(candles: Candle[], period = 14) {
  const window = candles.slice(-period)
  if (!window.length) return 50
  const low = Math.min(...window.map(c => c.low))
  const high = Math.max(...window.map(c => c.high))
  return high === low ? 50 : finite(((window.at(-1)!.close - low) / (high - low)) * 100, 50)
}

function signalFromScore(score: number): Signal {
  if (score >= 3) return "GÜÇLÜ AL"
  if (score >= 1) return "AL"
  if (score <= -3) return "GÜÇLÜ SAT"
  if (score <= -1) return "SAT"
  return "TUT"
}

export function analyzeCandles(candles: Candle[]) {
  if (candles.length < 30) throw new Error("Teknik analiz için yeterli mum yok")
  const closes = candles.map(c => c.close)
  const price = closes.at(-1)!
  const sma20 = avg(closes.slice(-20))
  const sma50 = avg(closes.slice(-50))
  const ema12 = ema(closes, 12)
  const ema26 = ema(closes, 26)
  const macdSeries = ema12.map((value, i) => value - (ema26[i] ?? value))
  const macd = macdSeries.at(-1) ?? 0
  const macdSignal = ema(macdSeries, 9).at(-1) ?? 0
  const currentRsi = rsi(closes)
  const currentStoch = stochastic(candles)
  const currentAtr = atr(candles)
  const deviation = Math.sqrt(avg(closes.slice(-20).map(v => (v - sma20) ** 2)))
  const upper = sma20 + deviation * 2
  const lower = sma20 - deviation * 2
  const bandwidthPosition = upper === lower ? 50 : ((price - lower) / (upper - lower)) * 100
  const support = Math.min(...candles.slice(-20).map(c => c.low))
  const resistance = Math.max(...candles.slice(-20).map(c => c.high))
  const swingWindow = candles.slice(-90)
  const swingLow = Math.min(...swingWindow.map(c => c.low))
  const swingHigh = Math.max(...swingWindow.map(c => c.high))
  const swingRange = swingHigh - swingLow
  const fibonacci = {
    low: swingLow,
    level236: swingHigh - swingRange * 0.236,
    level382: swingHigh - swingRange * 0.382,
    level500: swingHigh - swingRange * 0.5,
    level618: swingHigh - swingRange * 0.618,
    high: swingHigh,
  }
  let score = 0
  score += price > sma20 ? 1 : -1
  score += price > sma50 ? 1 : -1
  score += macd > macdSignal ? 1 : -1
  score += currentRsi > 55 && currentRsi < 72 ? 1 : currentRsi > 78 || currentRsi < 30 ? -1 : 0
  score += currentStoch > 55 && currentStoch < 82 ? 1 : currentStoch > 88 ? -1 : 0
  const signal = signalFromScore(score)
  const confidence = Math.min(88, Math.max(48, 52 + Math.abs(score) * 7))
  return {
    price, signal, confidence, support, resistance,
    values: { rsi: currentRsi, macd, macdSignal, sma20, sma50, bollinger: bandwidthPosition, stochastic: currentStoch, atr: currentAtr },
    fibonacci,
    chart: candles.slice(-70).map((c, i, rows) => ({ date: c.date, price: c.close, sma: avg(rows.slice(Math.max(0, i - 19), i + 1).map(x => x.close)) })),
  }
}

export function horizonAdvice(candles: Candle[]) {
  const configurations = [
    { key: "gunluk", label: "Günlük", slice: 45 },
    { key: "haftalik", label: "Haftalık", slice: 90 },
    { key: "aylik", label: "Aylık", slice: 180 },
  ]
  return configurations.map(config => {
    const result = analyzeCandles(candles.slice(-Math.max(config.slice, 30)))
    const action = result.signal.includes("AL") ? "Geri çekilmelerde kademeli izlenebilir" : result.signal.includes("SAT") ? "Riski azalt, destek tepkisini bekle" : "Pozisyonu koru, kırılımı bekle"
    return { ...config, signal: result.signal, confidence: result.confidence, action, invalidation: result.support, target: result.resistance }
  })
}
