'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Wifi, WifiOff } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Candle {
  time:   number
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

interface Divergence {
  type:       'bullish' | 'bearish'
  startIdx:   number
  endIdx:     number
  startPrice: number
  endPrice:   number
  startRsi:   number
  endRsi:     number
}

// ─── RSI Calculation ──────────────────────────────────────────────────────────
function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(closes.length).fill(50)
  if (closes.length < period + 1) return rsi
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff)
  }
  avgGain /= period; avgLoss /= period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return rsi
}

// ─── Pivot Points ─────────────────────────────────────────────────────────────
function findPivotLows(values: number[], left = 5): (number | null)[] {
  const pivots: (number | null)[] = new Array(values.length).fill(null)
  for (let i = left; i < values.length - left; i++) {
    let isPivot = true
    for (let j = i - left; j <= i + left; j++) {
      if (j !== i && values[j] <= values[i]) { isPivot = false; break }
    }
    if (isPivot) pivots[i] = values[i]
  }
  return pivots
}

function findPivotHighs(values: number[], left = 5): (number | null)[] {
  const pivots: (number | null)[] = new Array(values.length).fill(null)
  for (let i = left; i < values.length - left; i++) {
    let isPivot = true
    for (let j = i - left; j <= i + left; j++) {
      if (j !== i && values[j] >= values[i]) { isPivot = false; break }
    }
    if (isPivot) pivots[i] = values[i]
  }
  return pivots
}

// ─── Divergence Detection ─────────────────────────────────────────────────────
function detectDivergences(candles: Candle[], rsi: number[]): Divergence[] {
  const divergences: Divergence[] = []
  const lows   = candles.map(c => c.low)
  const highs  = candles.map(c => c.high)
  const pivotL = findPivotLows(lows)
  const pivotH = findPivotHighs(highs)
  const pivotLR = findPivotLows(rsi)
  const pivotHR = findPivotHighs(rsi)

  // Bullish: price lower low, RSI higher low
  const lowIdxs = pivotL.map((v, i) => v !== null ? i : -1).filter(i => i >= 0)
  for (let k = 1; k < lowIdxs.length; k++) {
    const i = lowIdxs[k - 1], j = lowIdxs[k]
    if (lows[j] < lows[i] && rsi[j] > rsi[i] && pivotLR[j] !== null)
      divergences.push({ type: 'bullish', startIdx: i, endIdx: j,
        startPrice: lows[i], endPrice: lows[j], startRsi: rsi[i], endRsi: rsi[j] })
  }
  //volume profile
function calcVolumeProfile(candles: Candle[], bins = 24) {
  const prices = candles.flatMap(c => [c.high, c.low])
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const step = (max - min) / bins

  const profile = new Array(bins).fill(0)

  candles.forEach(c => {
    const avg = (c.high + c.low + c.close) / 3
    const idx = Math.min(bins - 1, Math.floor((avg - min) / step))
    profile[idx] += c.volume
  })

  return { profile, min, step }
}
  // Bearish: price higher high, RSI lower high
  const highIdxs = pivotH.map((v, i) => v !== null ? i : -1).filter(i => i >= 0)
  for (let k = 1; k < highIdxs.length; k++) {
    const i = highIdxs[k - 1], j = highIdxs[k]
    if (highs[j] > highs[i] && rsi[j] < rsi[i] && pivotHR[j] !== null)
      divergences.push({ type: 'bearish', startIdx: i, endIdx: j,
        startPrice: highs[i], endPrice: highs[j], startRsi: rsi[i], endRsi: rsi[j] })
  }
  return divergences
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ChartPage() {
  const priceCanvasRef = useRef<HTMLCanvasElement>(null)
  const rsiCanvasRef   = useRef<HTMLCanvasElement>(null)
  const wsRef          = useRef<WebSocket | null>(null)

  const [candles,     setCandles]     = useState<Candle[]>([])
  const [livePrice,   setLivePrice]   = useState(0)
  const [prevClose,   setPrevClose]   = useState(0)
  const [connected,   setConnected]   = useState(false)
  const [lastUpdate,  setLastUpdate]  = useState('')
  const [divergences, setDivergences] = useState<Divergence[]>([])
  const VISIBLE = 80

  // ─── Fetch historical candles ─────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    try {
      const r = await fetch(
        'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=200'
      )
      const data = await r.json()
      const parsed: Candle[] = data.map((d: any) => ({
        time: d[0], open: parseFloat(d[1]), high: parseFloat(d[2]),
        low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5]),
      }))
      setCandles(parsed)
      setLivePrice(parsed[parsed.length - 1].close)
      setPrevClose(parsed[parsed.length - 2]?.close ?? 0)
    } catch (e) { console.error('History fetch failed', e) }
  }, [])

  // ─── WebSocket ────────────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    // Don't reconnect if already open or connecting
    if (wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
         wsRef.current.readyState === WebSocket.CONNECTING)) return

    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1h')
    wsRef.current = ws

    ws.onopen  = () => { setConnected(true); console.log('WS connected') }
    ws.onclose = (e) => {
      setConnected(false)
      // Only reconnect if not a deliberate close (code 1000)
      if (e.code !== 1000) setTimeout(connectWS, 5000)
    }
    ws.onerror = () => { /* let onclose handle reconnect */ }
    ws.onmessage = (e) => {
      try {
        const k = JSON.parse(e.data).k
        const candle: Candle = {
          time: k.t, open: parseFloat(k.o), high: parseFloat(k.h),
          low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v),
        }
        setLivePrice(candle.close)
        setLastUpdate(new Date().toLocaleTimeString())
        setCandles(prev => {
          const updated = [...prev]
          if (updated.length && updated[updated.length - 1].time === candle.time)
            updated[updated.length - 1] = candle
          else { setPrevClose(updated[updated.length - 1]?.close ?? 0); updated.push(candle) }
          return updated.slice(-300)
        })
      } catch (err) { console.error('WS parse error', err) }
    }
  }, [])

  useEffect(() => {
    fetchHistory().then(() => {
      setTimeout(connectWS, 500)
    })

    // Polling fallback every 5s — updates chart even if WS fails
    const poll = setInterval(async () => {
      try {
        const r = await fetch(
          'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=5'
        )
        const data = await r.json()
        const latest: Candle = {
          time:   data[data.length-1][0],
          open:   parseFloat(data[data.length-1][1]),
          high:   parseFloat(data[data.length-1][2]),
          low:    parseFloat(data[data.length-1][3]),
          close:  parseFloat(data[data.length-1][4]),
          volume: parseFloat(data[data.length-1][5]),
        }
        setLivePrice(latest.close)
        setLastUpdate(new Date().toLocaleTimeString())
        setCandles(prev => {
          const updated = [...prev]
          if (updated.length && updated[updated.length-1].time === latest.time)
            updated[updated.length-1] = latest
          else updated.push(latest)
          return updated.slice(-300)
        })
      } catch {}
    }, 5000)

    return () => {
      clearInterval(poll)
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted')
        wsRef.current = null
      }
    }
  }, [])

  // ─── Detect divergences ───────────────────────────────────────────────────
  useEffect(() => {
    if (candles.length < 30) return
    const rsi = calcRSI(candles.map(c => c.close))
    setDivergences(detectDivergences(candles, rsi))
  }, [candles])

  // ─── Draw Price Chart ─────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = priceCanvasRef.current
    if (!canvas || candles.length === 0) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    const PL = 72, PR = 10, PT = 20, PB = 28
    const CW = W - PL - PR, CH = H - PT - PB

    const visible  = candles.slice(-VISIBLE)
    const minP     = Math.min(...visible.map(c => c.low))  * 0.9985
    const maxP     = Math.max(...visible.map(c => c.high)) * 1.0015
    const range    = maxP - minP
    const toX      = (i: number) => PL + (i / (VISIBLE - 1)) * CW
    const toY      = (p: number) => PT + (1 - (p - minP) / range) * CH

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0d1117'
    ctx.fillRect(0, 0, W, H)

    // Grid
    for (let i = 0; i <= 6; i++) {
      const y = PT + (i / 6) * CH
      ctx.strokeStyle = '#1a2332'; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke()
      const price = maxP - (i / 6) * range
      ctx.fillStyle = '#4b5563'; ctx.font = '10px JetBrains Mono,monospace'
      ctx.textAlign = 'right'
      ctx.fillText('$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 }), PL - 4, y + 3)
    }

    // Divergence lines
    const startIdx = candles.length - VISIBLE
    divergences.forEach(div => {
      const si = div.startIdx - startIdx, ei = div.endIdx - startIdx
      if (si < 0 || ei < 0 || si >= VISIBLE || ei >= VISIBLE) return
      const color = div.type === 'bullish' ? '#10b981' : '#ef4444'
      ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.setLineDash([5, 3])
      ctx.beginPath(); ctx.moveTo(toX(si), toY(div.startPrice))
      ctx.lineTo(toX(ei), toY(div.endPrice)); ctx.stroke(); ctx.setLineDash([])
      // D label
      const lx = toX(ei), ly = div.type === 'bullish' ? toY(div.endPrice) + 18 : toY(div.endPrice) - 10
      ctx.fillStyle = '#0d1117'
      ctx.fillRect(lx - 8, ly - 10, 16, 14)
      ctx.fillStyle = color; ctx.font = 'bold 11px JetBrains Mono,monospace'
      ctx.textAlign = 'center'; ctx.fillText('D', lx, ly)
    })

    // Candles
    const cw = Math.max(2, (CW / VISIBLE) * 0.65)
    visible.forEach((c, i) => {
      const x     = toX(i)
      const isUp  = c.close >= c.open
      const color = isUp ? '#26a69a' : '#ef5350'
      const bt    = toY(Math.max(c.open, c.close))
      const bb    = toY(Math.min(c.open, c.close))
      const bh    = Math.max(1, bb - bt)
      ctx.strokeStyle = color; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke()
      ctx.fillStyle = color
      ctx.fillRect(x - cw / 2, bt, cw, bh)
    })

    // X-axis
    const every = Math.ceil(VISIBLE / 8)
    ctx.fillStyle = '#4b5563'; ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'center'
    visible.forEach((c, i) => {
      if (i % every === 0) {
        const d = new Date(c.time)
        ctx.fillText(`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}h`, toX(i), H - PB + 14)
      }
    })

    // Current price line
    const cy = toY(livePrice)
    ctx.strokeStyle = '#f5a623'; ctx.lineWidth = 0.8; ctx.setLineDash([5, 4])
    ctx.beginPath(); ctx.moveTo(PL, cy); ctx.lineTo(W - PR, cy); ctx.stroke(); ctx.setLineDash([])
    // Price tag
    const tag = '$' + livePrice.toLocaleString('en-US', { maximumFractionDigits: 0 })
    ctx.fillStyle = '#f5a623'; ctx.font = 'bold 10px JetBrains Mono,monospace'
    ctx.textAlign = 'right'; ctx.fillText(tag, PL - 4, cy + 3)

  }, [candles, divergences, livePrice])

  // ─── Draw RSI Chart ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = rsiCanvasRef.current
    if (!canvas || candles.length === 0) return
    const ctx = canvas.getContext('2d')!
    const W = canvas.width, H = canvas.height
    const PL = 72, PR = 10, PT = 10, PB = 18
    const CW = W - PL - PR, CH = H - PT - PB

    const rsiAll  = calcRSI(candles.map(c => c.close))
    const visible = rsiAll.slice(-VISIBLE)
    const toX     = (i: number) => PL + (i / (VISIBLE - 1)) * CW
    const toY     = (v: number) => PT + (1 - v / 100) * CH

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, W, H)

    // OB/OS zones
    ctx.fillStyle = 'rgba(239,68,68,0.07)'; ctx.fillRect(PL, PT, CW, toY(70) - PT)
    ctx.fillStyle = 'rgba(16,185,129,0.07)'; ctx.fillRect(PL, toY(30), CW, PT + CH - toY(30))

    // Level lines
    ;([70, 50, 30] as number[]).forEach(lvl => {
      const y = toY(lvl)
      ctx.strokeStyle = lvl === 50 ? '#1f2937' : lvl === 70 ? '#ef444455' : '#10b98155'
      ctx.lineWidth = 0.8; ctx.setLineDash(lvl === 50 ? [4,4] : [])
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = lvl === 70 ? '#ef4444' : lvl === 30 ? '#10b981' : '#374151'
      ctx.font = '9px JetBrains Mono,monospace'; ctx.textAlign = 'right'
      ctx.fillText(String(lvl), PL - 4, y + 3)
    })

    // RSI line with color based on level
    ctx.lineWidth = 1.5
    for (let i = 1; i < visible.length; i++) {
      const v = visible[i]
      ctx.strokeStyle = v > 70 ? '#ef4444' : v < 30 ? '#10b981' : '#a78bfa'
      ctx.beginPath(); ctx.moveTo(toX(i-1), toY(visible[i-1])); ctx.lineTo(toX(i), toY(v)); ctx.stroke()
    }

    // Divergence lines on RSI
    const startIdx = candles.length - VISIBLE
    detectDivergences(candles, rsiAll).forEach(div => {
      const si = div.startIdx - startIdx, ei = div.endIdx - startIdx
      if (si < 0 || ei < 0 || si >= VISIBLE || ei >= VISIBLE) return
      const color = div.type === 'bullish' ? '#10b981' : '#ef4444'
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3])
      ctx.beginPath(); ctx.moveTo(toX(si), toY(div.startRsi))
      ctx.lineTo(toX(ei), toY(div.endRsi)); ctx.stroke(); ctx.setLineDash([])
    })

    // RSI label + current value
    const cur = visible[visible.length - 1]
    ctx.fillStyle = '#6b7280'; ctx.font = 'bold 10px JetBrains Mono,monospace'; ctx.textAlign = 'left'
    ctx.fillText('RSI(14)', PL + 4, PT + 12)
    const rsiColor = cur > 70 ? '#ef4444' : cur < 30 ? '#10b981' : '#a78bfa'
    ctx.fillStyle = rsiColor; ctx.textAlign = 'right'
    ctx.fillText(cur.toFixed(1), PL - 4, toY(cur) + 3)

  }, [candles])

  const latestDiv   = divergences[divergences.length - 1]
  const priceChange = prevClose > 0 ? ((livePrice - prevClose) / prevClose * 100) : 0
  const isUp        = priceChange >= 0

  return (
    <div style={{ background: '#080b12', minHeight: '100vh', padding: '16px 20px',
      fontFamily: 'JetBrains Mono, monospace', color: '#e5e7eb' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px',
        marginBottom: '12px', flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: '#4b5563', textDecoration: 'none',
          display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px' }}>
          <ArrowLeft size={13} /> Dashboard
        </Link>

        <span style={{ fontSize: '20px', fontWeight: 800, color: '#fff',
          fontFamily: 'Syne, sans-serif', letterSpacing: '-0.5px' }}>
          BTC / USDT
        </span>
        <span style={{ fontSize: '11px', color: '#4b5563',
          background: '#111827', border: '1px solid #1f2937',
          padding: '2px 8px', borderRadius: '4px' }}>
          1H · Binance
        </span>

        <div style={{ fontSize: '24px', fontWeight: 700, color: '#f5a623',
          fontFamily: 'Syne, sans-serif', letterSpacing: '-0.5px' }}>
          ${livePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>

        <div style={{ fontSize: '12px', fontWeight: 600,
          color: isUp ? '#10b981' : '#ef4444' }}>
          {isUp ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center',
          gap: '5px', fontSize: '10px',
          color: connected ? '#10b981' : '#ef4444' }}>
          {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
          {connected ? `LIVE · ${lastUpdate}` : 'Reconnecting…'}
        </div>
      </div>

      {/* Divergence alert */}
      {latestDiv && (
        <div style={{
          padding: '8px 14px', borderRadius: '8px', marginBottom: '10px',
          display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px',
          background: latestDiv.type === 'bullish' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${latestDiv.type === 'bullish' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
        }}>
          <span style={{ fontWeight: 700, fontSize: '12px',
            color: latestDiv.type === 'bullish' ? '#10b981' : '#ef4444' }}>
            {latestDiv.type === 'bullish' ? '▲ BULLISH DIVERGENCE' : '▼ BEARISH DIVERGENCE'}
          </span>
          <span style={{ color: '#9ca3af' }}>
            @ ${latestDiv.endPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })} ·
            RSI {latestDiv.endRsi.toFixed(1)}
          </span>
          <span style={{ color: '#6b7280', marginLeft: 'auto' }}>
            {latestDiv.type === 'bullish'
              ? '⬇ Price lower low + ⬆ RSI higher low → possible reversal UP'
              : '⬆ Price higher high + ⬇ RSI lower high → possible reversal DOWN'}
          </span>
        </div>
      )}

      {/* Price canvas */}
      <div style={{ borderRadius: '10px', border: '1px solid #1a2332', overflow: 'hidden', marginBottom: '3px' }}>
        <canvas ref={priceCanvasRef} width={1400} height={500}
          style={{ width: '100%', height: 'auto', display: 'block' }} />
      </div>

      {/* RSI canvas */}
      <div style={{ borderRadius: '10px', border: '1px solid #1a2332', overflow: 'hidden', marginBottom: '14px' }}>
        <canvas ref={rsiCanvasRef} width={1400} height={150}
          style={{ width: '100%', height: 'auto', display: 'block' }} />
      </div>

      {/* Divergence list */}
      {divergences.length > 0 && (
        <div style={{ borderRadius: '10px', border: '1px solid #1a2332',
          background: '#0d1117', padding: '14px' }}>
          <div style={{ fontSize: '10px', color: '#4b5563', marginBottom: '10px',
            letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            Detected Divergences (last 6)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {divergences.slice(-6).reverse().map((div, i) => {
              const c = candles[div.endIdx]
              const d = c ? new Date(c.time) : null
              const color = div.type === 'bullish' ? '#10b981' : '#ef4444'
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '7px 12px', borderRadius: '7px', fontSize: '11px',
                  background: div.type === 'bullish' ? 'rgba(16,185,129,0.04)' : 'rgba(239,68,68,0.04)',
                  border: `1px solid ${div.type === 'bullish' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'}`,
                }}>
                  <span style={{ fontWeight: 700, minWidth: '55px', color }}>
                    {div.type === 'bullish' ? '▲ BULL' : '▼ BEAR'}
                  </span>
                  <span style={{ color: '#6b7280', minWidth: '110px' }}>
                    {d ? `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:00` : ''}
                  </span>
                  <span style={{ color: '#d1d5db' }}>
                    ${div.endPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </span>
                  <span style={{ color: '#4b5563' }}>
                    RSI: {div.startRsi.toFixed(1)} → {div.endRsi.toFixed(1)}
                  </span>
                  <span style={{ marginLeft: 'auto', color, fontSize: '10px' }}>
                    {div.type === 'bullish' ? 'Watch for reversal ↑' : 'Watch for reversal ↓'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: '9px', color: '#1f2937', marginTop: '14px' }}>
        BTC Oracle · Real-time 1H Candlesticks · RSI Divergence · Binance WebSocket · Not financial advice
      </div>
    </div>
  )
}
