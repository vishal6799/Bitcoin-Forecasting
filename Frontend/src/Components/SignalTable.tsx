'use client'

import { TrendingUp, TrendingDown } from 'lucide-react'

interface Props {
  actual:    number[]
  predicted: number[]
  signals:   string[]
}

export default function SignalTable({ actual, predicted, signals }: Props) {
  const rows = signals.slice(-20).map((s, i) => {
    const idx = signals.length - 20 + i
    return {
      idx,
      actual:    actual[idx],
      predicted: predicted[idx],
      signal:    s,
      delta:     predicted[idx] - actual[idx],
    }
  }).reverse()

  const buyCount  = signals.filter(s => s === 'BUY').length
  const sellCount = signals.filter(s => s === 'SELL').length
  const buyPct    = Math.round((buyCount / Math.max(signals.length, 1)) * 100)

  return (
    <div className="flex flex-col gap-4">
      {/* Summary */}
      <div className="flex gap-3">
        <div className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-lg border border-emerald/20 bg-emerald/5">
          <span className="text-[10px] text-muted uppercase tracking-widest">Buy signals</span>
          <span className="text-emerald font-display font-bold text-lg">{buyCount}</span>
        </div>
        <div className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-lg border border-crimson/20 bg-crimson/5">
          <span className="text-[10px] text-muted uppercase tracking-widest">Sell signals</span>
          <span className="text-crimson font-display font-bold text-lg">{sellCount}</span>
        </div>
        <div className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-lg border border-gold/20 bg-gold/5">
          <span className="text-[10px] text-muted uppercase tracking-widest">Bull bias</span>
          <span className="text-gold font-display font-bold text-lg">{buyPct}%</span>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border bg-surface/60">
              <th className="text-left px-4 py-2.5 text-muted text-[10px] uppercase tracking-widest">#</th>
              <th className="text-right px-4 py-2.5 text-muted text-[10px] uppercase tracking-widest">Actual</th>
              <th className="text-right px-4 py-2.5 text-muted text-[10px] uppercase tracking-widest">Predicted</th>
              <th className="text-right px-4 py-2.5 text-muted text-[10px] uppercase tracking-widest">Δ</th>
              <th className="text-center px-4 py-2.5 text-muted text-[10px] uppercase tracking-widest">Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.idx}
                className={`border-b border-border/50 transition-colors hover:bg-surface/60
                  ${i === 0 ? 'bg-surface/40' : ''}`}>
                <td className="px-4 py-2 text-muted">{r.idx}</td>
                <td className="px-4 py-2 text-right text-gray-300">
                  ${r.actual?.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                </td>
                <td className="px-4 py-2 text-right text-ice">
                  ${r.predicted?.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                </td>
                <td className={`px-4 py-2 text-right ${r.delta > 0 ? 'text-emerald' : 'text-crimson'}`}>
                  {r.delta > 0 ? '+' : ''}{r.delta?.toFixed(0)}
                </td>
                <td className="px-4 py-2 text-center">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded
                    text-[10px] font-bold tracking-widest
                    ${r.signal === 'BUY'
                      ? 'bg-emerald/10 text-emerald border border-emerald/20'
                      : 'bg-crimson/10 text-crimson border border-crimson/20'}`}>
                    {r.signal === 'BUY'
                      ? <TrendingUp size={9} />
                      : <TrendingDown size={9} />}
                    {r.signal}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}