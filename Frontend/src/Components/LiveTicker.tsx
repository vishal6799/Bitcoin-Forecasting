'use client'

import { useEffect, useState, useRef } from 'react'
import { TrendingUp, TrendingDown, Zap } from 'lucide-react'
import { api, LivePrice } from '@/lib/api'

export default function LiveTicker() {
  const [data, setData]         = useState<LivePrice | null>(null)
  const [prev, setPrev]         = useState<number | null>(null)
  const [flash, setFlash]       = useState<'up' | 'down' | null>(null)
  const [error, setError]       = useState(false)
  const intervalRef             = useRef<NodeJS.Timeout>()

  const fetchPrice = async () => {
    try {
      const fresh = await api.livePrice()
      setData(d => {
        if (d) {
          setPrev(d.price)
          setFlash(fresh.price > d.price ? 'up' : 'down')
          setTimeout(() => setFlash(null), 600)
        }
        return fresh
      })
      setError(false)
    } catch { setError(true) }
  }

  useEffect(() => {
    fetchPrice()
    intervalRef.current = setInterval(fetchPrice, 15000)
    return () => clearInterval(intervalRef.current)
  }, [])

  const isUp = (data?.change ?? 0) >= 0

  return (
    <div className={`
      relative flex items-center gap-4 px-6 py-4 rounded-xl border
      bg-panel/80 backdrop-blur-sm transition-all duration-300
      ${flash === 'up'   ? 'border-emerald/60 glow-green' :
        flash === 'down' ? 'border-crimson/60 glow-red'   :
                           'border-border glow-gold'}
    `}>
      {/* Live dot */}
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-gold" />
      </span>

      <div className="flex flex-col">
        <span className="text-[10px] text-muted tracking-widest uppercase font-display">Bitcoin / USD</span>
        {error ? (
          <span className="text-muted text-sm">— unavailable —</span>
        ) : data ? (
          <span className={`
            text-2xl font-display font-bold tracking-tight transition-colors duration-300
            ${flash === 'up' ? 'text-emerald' : flash === 'down' ? 'text-crimson' : 'text-gold'}
          `}>
            ${data.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span>
        ) : (
          <span className="text-gold text-2xl font-display animate-pulse">Loading…</span>
        )}
      </div>

      {data && (
        <div className={`ml-auto flex items-center gap-1 text-sm font-mono ${isUp ? 'text-emerald' : 'text-crimson'}`}>
          {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {isUp ? '+' : ''}{data.change.toFixed(2)}%
          <span className="text-muted text-[10px] ml-1">24h</span>
        </div>
      )}

      <div className="absolute top-2 right-3 text-[9px] text-muted/50 font-mono">
        <Zap size={9} className="inline mr-1 text-gold/40" />LIVE · 15s
      </div>
    </div>
  )
}
