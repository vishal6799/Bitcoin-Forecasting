'use client'

import { useState, useCallback } from 'react'
import { Brain, RefreshCw, Activity, BarChart2, AlertTriangle, CheckCircle2, CandlestickChart } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import LiveTicker from '@/components/LiveTicker'
import SignalTable from '@/components/SignalTable'
import TradingSignal from '@/components/TradingSignal'
import { api, PredictResponse, MetaInfo } from '@/lib/api'

const PredictionChart = dynamic(() => import('@/components/PredictionChart'), { ssr: false })

type Status = 'idle' | 'training' | 'loading' | 'ready' | 'error'

export default function Dashboard() {
  const [status,  setStatus]  = useState<Status>('idle')
  const [data,    setData]    = useState<PredictResponse | null>(null)
  const [meta,    setMeta]    = useState<MetaInfo | null>(null)
  const [msg,     setMsg]     = useState('')

  const handleTrain = useCallback(async () => {
    setStatus('training')
    setMsg('Training Bidirectional LSTM… up to 100 epochs with early stopping. This may take 5–15 minutes.')
    try {
      const res = await api.train()
      setMeta(res)
      setMsg(`✅ Training complete · Dir. Accuracy: ${res.directional_accuracy.toFixed(1)}% · RMSE: $${res.rmse.toFixed(0)} · MAPE: ${res.mape.toFixed(2)}%`)
      await handlePredict()
    } catch {
      setStatus('error')
      setMsg('Training is running in backend — check terminal for progress. Click Load Predictions when epochs finish.')
      // Auto-retry predictions every 60s
      const retry = setInterval(async () => {
        try {
          const res = await api.predict(200)
          setData(res)
          if (res.meta) setMeta(res.meta)
          setStatus('ready')
          setMsg('')
          clearInterval(retry)
        } catch {}
      }, 60000)
      setTimeout(() => clearInterval(retry), 1800000) // stop after 30min
    }
  }, [])

  const handlePredict = useCallback(async () => {
    setStatus('loading')
    setMsg('Fetching predictions…')
    try {
      const res = await api.predict(200)
      setData(res)
      if (res.meta) setMeta(res.meta)
      setStatus('ready')
      setMsg('')
    } catch {
      setStatus('error')
      setMsg('Could not fetch predictions. Train the model first.')
    }
  }, [])

  return (
    <div className="min-h-screen bg-void px-4 py-8 md:px-10 animate-fade-in">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[30%] w-[600px] h-[600px] rounded-full bg-gold/3 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[10%] w-[400px] h-[400px] rounded-full bg-ice/3 blur-[100px]" />
      </div>

      <div className="relative max-w-6xl mx-auto flex flex-col gap-8">

        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Brain className="text-gold" size={28} />
              <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">BTC Oracle</h1>
              <span className="text-[10px] border border-gold/30 text-gold/70 px-2 py-0.5 rounded font-mono tracking-widest uppercase">
                BiLSTM + Attention
              </span>
            </div>
            <p className="text-muted text-sm font-mono">
              Live trading signals · 24 technical indicators · Daily BTC/USDT
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleTrain}
              disabled={status === 'training'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gold/30
                bg-gold/5 text-gold text-sm font-mono hover:bg-gold/10 hover:border-gold/60
                transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Brain size={14} />
              {status === 'training' ? 'Training…' : 'Train Model'}
            </button>
            <button
              onClick={handlePredict}
              disabled={status === 'loading' || status === 'training'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-ice/30
                bg-ice/5 text-ice text-sm font-mono hover:bg-ice/10 hover:border-ice/60
                transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={status === 'loading' ? 'animate-spin' : ''} />
              {status === 'loading' ? 'Loading…' : 'Load Predictions'}
            </button>
            <Link
              href="/chart"
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald/30
                bg-emerald/5 text-emerald text-sm font-mono hover:bg-emerald/10 hover:border-emerald/60
                transition-all"
            >
              <CandlestickChart size={14} />
              Live Chart
            </Link>
          </div>
        </header>

        {/* Live Ticker */}
        <LiveTicker />

        {/* Status */}
        {msg && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm font-mono
            ${status === 'error'
              ? 'border-crimson/30 bg-crimson/5 text-crimson'
              : status === 'ready'
                ? 'border-emerald/30 bg-emerald/5 text-emerald'
                : 'border-gold/20 bg-gold/5 text-gold/80'}`}>
            {status === 'error'  ? <AlertTriangle size={14} /> :
             status === 'ready'  ? <CheckCircle2  size={14} /> :
             <Activity size={14} className="animate-pulse" />}
            {msg}
          </div>
        )}

        {/* Model metrics */}
        {meta && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-slide-up">
            {[
              { label: 'Ensemble Acc',  value: `${(meta as any).ensemble_dir_accuracy?.toFixed(1) ?? meta.directional_accuracy?.toFixed(1)}%`, color: 'text-emerald' },
              { label: 'Clf Acc',       value: `${(meta as any).classification_accuracy?.toFixed(1) ?? '—'}%`, color: 'text-ice' },
              { label: 'RMSE',          value: `$${meta.rmse?.toFixed(0)}`,                  color: 'text-gold'    },
              { label: 'Features',      value: `${meta.features} indicators`,                color: 'text-gray-300'},
            ].map(m => (
              <div key={m.label} className="px-4 py-3 rounded-xl border border-border bg-panel/60">
                <p className="text-[10px] text-muted uppercase tracking-widest mb-1">{m.label}</p>
                <p className={`text-lg font-display font-bold ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tomorrow's live trading signal */}
        <TradingSignal />

        {/* Chart */}
        {data && (
          <div className="rounded-2xl border border-border bg-panel/60 backdrop-blur-sm p-6 animate-slide-up">
            <div className="flex items-center gap-2 mb-6">
              <BarChart2 size={16} className="text-gold" />
              <h2 className="font-display font-bold text-white text-lg">Price Forecast</h2>
              <span className="ml-auto text-[10px] text-muted font-mono">
                {data.actual.length} data points · {data.meta?.date_range}
              </span>
            </div>
            <PredictionChart
              actual={data.actual}
              predicted={data.predicted}
              signals={data.signals}
              confidences={data.confidences}
              dates={data.dates}
              mode="recent"
            />
          </div>
        )}

        {/* Signal table */}
        {data && (
          <div className="rounded-2xl border border-border bg-panel/60 backdrop-blur-sm p-6 animate-slide-up">
            <div className="flex items-center gap-2 mb-6">
              <Activity size={16} className="text-ice" />
              <h2 className="font-display font-bold text-white text-lg">Trading Signals</h2>
              <span className="ml-auto text-[10px] text-muted font-mono">last 20 shown</span>
            </div>
            <SignalTable
              actual={data.actual}
              predicted={data.predicted}
              signals={data.signals}
            />
          </div>
        )}

        {/* Empty state */}
        {status === 'idle' && (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
            <Brain size={48} className="text-muted/40" />
            <p className="text-muted font-mono text-sm max-w-sm">
              Click <span className="text-gold">Train Model</span> to train the BiLSTM on full BTC history,
              then get live signals with stop loss and take profit. Or click{' '}
              <span className="text-emerald">Live Chart</span> for real-time candlesticks.
            </p>
          </div>
        )}

        <footer className="text-center text-[10px] text-muted/40 font-mono pb-4">
          BTC Oracle · BiLSTM + Attention · 24 Features · Not financial advice
        </footer>
      </div>
    </div>
  )
}