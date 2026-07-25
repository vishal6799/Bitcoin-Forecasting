'use client'

import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceDot,
} from 'recharts'

interface Props {
  actual:       number[]
  predicted:    number[]
  signals:      string[]
  confidences?: number[]
  dates?:       string[]
  mode?:        'recent' | 'full'
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="custom-tooltip">
      <p className="text-muted text-[10px] mb-2">{d?.date || `#${label}`}</p>
      {payload.map((p: any) => p.value > 0 && (
        <p key={p.name} style={{ color: p.color }} className="text-xs mb-0.5">
          {p.name}: <span className="font-bold">
            ${p.value?.toLocaleString('en-US', { minimumFractionDigits: 0 })}
          </span>
        </p>
      ))}
      {d?.signal && (
        <p className={`text-[10px] mt-1.5 font-bold tracking-widest
          ${d.signal === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
          ▶ {d.signal} {d.confidence ? `(${d.confidence}% conf)` : ''}
        </p>
      )}
    </div>
  )
}

export default function PredictionChart({ actual, predicted, signals, confidences, dates, mode = 'recent' }: Props) {
  const data = actual.map((a, i) => ({
    index:      i,
    date:       dates?.[i] ?? `#${i}`,
    Actual:     Math.round(a),
    Predicted:  Math.round(predicted[i] ?? 0),
    signal:     signals[i],
    confidence: confidences?.[i] ?? 0,
  }))

  const allPrices = data.flatMap(d => [d.Actual, d.Predicted]).filter(v => v > 0)
  const minPrice  = Math.min(...allPrices)
  const maxPrice  = Math.max(...allPrices)
  const pad       = (maxPrice - minPrice) * 0.05
  const yMin      = Math.floor((minPrice - pad) / 100) * 100
  const yMax      = Math.ceil((maxPrice  + pad) / 100) * 100

  // Signal crossover dots
  const highlights = data.filter((d, i) =>
    i > 0 && data[i - 1].signal !== d.signal
  ).slice(0, 12)

  // X-axis: show dates every ~30 points
  const xInterval = Math.max(1, Math.floor(data.length / 8))

  return (
    <div className="w-full h-[440px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f5a623" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#f5a623" stopOpacity={0}   />
            </linearGradient>
            <linearGradient id="predictedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#67e8f9" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#67e8f9" stopOpacity={0}    />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />

          <XAxis
            dataKey="date"
            stroke="#374151"
            tick={{ fill: '#6b7280', fontSize: 9, fontFamily: 'JetBrains Mono' }}
            tickLine={false}
            interval={xInterval}
          />

          <YAxis
            stroke="#374151"
            tick={{ fill: '#6b7280', fontSize: 10, fontFamily: 'JetBrains Mono' }}
            tickLine={false}
            tickFormatter={v => `$${(v/1000).toFixed(0)}k`}
            width={58}
            domain={[yMin, yMax]}
          />

          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 11, paddingTop: 12 }} />

          <Area type="monotone" dataKey="Actual"
            stroke="#f5a623" strokeWidth={2}
            fill="url(#actualGrad)" dot={false}
            activeDot={{ r: 4, fill: '#f5a623', strokeWidth: 0 }} />

          <Area type="monotone" dataKey="Predicted"
            stroke="#67e8f9" strokeWidth={1.5}
            fill="url(#predictedGrad)" dot={false}
            strokeDasharray="5 3"
            activeDot={{ r: 4, fill: '#67e8f9', strokeWidth: 0 }} />

          {highlights.map((d, i) => (
            <ReferenceDot key={i} x={d.date} y={d.Actual} r={5}
              fill={d.signal === 'BUY' ? '#10b981' : '#ef4444'} stroke="none" />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex gap-6 mt-2 text-[10px] font-mono text-muted px-2 flex-wrap">
        <span><span className="text-gold">━━</span> Actual price</span>
        <span><span className="text-ice">╌╌</span> BiLSTM predicted</span>
        <span><span style={{color:'#10b981'}}>●</span> BUY crossover</span>
        <span><span style={{color:'#ef4444'}}>●</span> SELL crossover</span>
      </div>
    </div>
  )
}