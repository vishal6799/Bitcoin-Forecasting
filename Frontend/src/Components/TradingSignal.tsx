'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Target, Shield, Zap, RefreshCw } from 'lucide-react'
import { api, NextPrediction } from '@/lib/api'

export default function TradingSignal() {
  const [data,    setData]    = useState<NextPrediction | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const fetchSignal = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.nextPrediction()
      setData(res)
    } catch {
      setError('Train model first to see live signal.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSignal()
    // Auto-retry every 30s in case model just finished training
    const interval = setInterval(fetchSignal, 30000)
    return () => clearInterval(interval)
  }, [])

  const isBuy = data?.signal === 'BUY'

  return (
    <div className={`rounded-2xl border p-6 transition-all
      ${isBuy
        ? 'border-emerald/30 bg-emerald/5'
        : data
          ? 'border-crimson/30 bg-crimson/5'
          : 'border-border bg-panel/60'}`}>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-gold" />
          <h2 className="font-display font-bold text-white text-lg">Tomorrow's Signal</h2>
        </div>
        <button onClick={fetchSignal} disabled={loading}
          className="text-muted hover:text-white transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <p className="text-muted text-sm font-mono">{error}</p>}

      {data && (
        <div className="flex flex-col gap-5">

          {/* Main signal */}
          <div className="flex items-center gap-4">
            <div className={`flex items-center justify-center w-20 h-20 rounded-2xl
              ${isBuy ? 'bg-emerald/20 border border-emerald/30' : 'bg-crimson/20 border border-crimson/30'}`}>
              {isBuy
                ? <TrendingUp  size={36} className="text-emerald" />
                : <TrendingDown size={36} className="text-crimson" />}
            </div>
            <div>
              <div className={`font-display text-4xl font-extrabold tracking-tight
                ${isBuy ? 'text-emerald' : 'text-crimson'}`}>
                {data.signal}
              </div>
              <div className="text-muted text-sm font-mono mt-1">
                Signal for: <span className="text-white">{data.date}</span>
              </div>
              <div className={`text-sm font-mono font-bold mt-1
                ${isBuy ? 'text-emerald' : 'text-crimson'}`}>
                {isBuy ? '▲' : '▼'} {Math.abs(data.delta_pct).toFixed(2)}% predicted move
              </div>
            </div>

            {/* Confidence gauge */}
            <div className="ml-auto text-center">
              <div className="text-[10px] text-muted uppercase tracking-widest mb-1">Confidence</div>
              <div className={`font-display text-3xl font-bold
                ${data.confidence > 66 ? 'text-emerald' : data.confidence > 33 ? 'text-gold' : 'text-crimson'}`}>
                {data.confidence.toFixed(0)}%
              </div>
              <div className="w-24 h-1.5 bg-muted/20 rounded-full mt-1.5 overflow-hidden">
                <div className={`h-full rounded-full transition-all
                  ${data.confidence > 66 ? 'bg-emerald' : data.confidence > 33 ? 'bg-gold' : 'bg-crimson'}`}
                  style={{ width: `${data.confidence}%` }} />
              </div>
            </div>
          </div>

          {/* Price targets */}
          <div className="grid grid-cols-3 gap-3">
            <div className="px-4 py-3 rounded-xl border border-border bg-surface/60">
              <div className="text-[9px] text-muted uppercase tracking-widest mb-1">Current</div>
              <div className="font-display text-white font-bold text-sm">
                ${data.current_price.toLocaleString()}
              </div>
            </div>
            <div className={`px-4 py-3 rounded-xl border ${isBuy ? 'border-emerald/20 bg-emerald/5' : 'border-crimson/20 bg-crimson/5'}`}>
              <div className="text-[9px] text-muted uppercase tracking-widest mb-1">Predicted</div>
              <div className={`font-display font-bold text-sm ${isBuy ? 'text-emerald' : 'text-crimson'}`}>
                ${data.predicted_price.toLocaleString()}
              </div>
            </div>
            <div className="px-4 py-3 rounded-xl border border-gold/20 bg-gold/5">
              <div className="text-[9px] text-muted uppercase tracking-widest mb-1">ATR</div>
              <div className="font-display text-gold font-bold text-sm">
                ${data.atr.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Stop loss / Take profit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-crimson/20 bg-crimson/5">
              <Shield size={16} className="text-crimson" />
              <div>
                <div className="text-[9px] text-muted uppercase tracking-widest">Stop Loss</div>
                <div className="text-crimson font-display font-bold text-sm">
                  ${data.stop_loss.toLocaleString()}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald/20 bg-emerald/5">
              <Target size={16} className="text-emerald" />
              <div>
                <div className="text-[9px] text-muted uppercase tracking-widest">Take Profit</div>
                <div className="text-emerald font-display font-bold text-sm">
                  ${data.take_profit.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Indicators */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'RSI',  value: data.rsi.toFixed(1),
                color: data.rsi > 70 ? 'text-crimson' : data.rsi < 30 ? 'text-emerald' : 'text-gold' },
              { label: 'MACD', value: data.macd.toFixed(2),
                color: data.macd > 0 ? 'text-emerald' : 'text-crimson' },
              { label: 'Signal', value: data.signal,
                color: isBuy ? 'text-emerald' : 'text-crimson' },
            ].map(ind => (
              <div key={ind.label} className="px-3 py-2 rounded-lg border border-border bg-surface/40 text-center">
                <div className="text-[9px] text-muted uppercase tracking-widest mb-1">{ind.label}</div>
                <div className={`font-mono font-bold text-sm ${ind.color}`}>{ind.value}</div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted/50 font-mono text-center">
            ⚠️ Not financial advice · Always use stop losses · Past performance ≠ future results
          {(data as any).models_agree !== undefined && (
            <span className={`ml-2 font-bold ${ (data as any).models_agree ? "text-emerald" : "text-gold"}`}>
              · {(data as any).models_agree ? "✓ Both models agree" : "⚡ Models disagree — lower confidence"}
            </span>
          )}
          </p>
        </div>
      )}
    </div>
  )
}