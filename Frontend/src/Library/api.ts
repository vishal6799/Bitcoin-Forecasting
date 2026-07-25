const BASE = '/api/backend'

export interface PredictResponse {
  actual:       number[]
  predicted:    number[]
  signals:      string[]
  confidences:  number[]
  stop_losses:  number[]
  take_profits: number[]
  dates:        string[]
  meta:         MetaInfo
}

export interface NextPrediction {
  date:            string  // tomorrow's date
  as_of:           string  // today's actual date
  current_price:   number
  predicted_price: number
  delta_pct:       number
  signal:          string
  confidence:      number
  stop_loss:       number
  take_profit:     number
  rsi:             number
  macd:            number
  atr:             number
}

export interface LivePrice {
  price:  number
  change: number
}

export interface MetaInfo {
  rmse:                 number
  mae:                  number
  mape:                 number
  directional_accuracy: number
  trained_on:           number
  date_range:           string
  epochs_run:           number
  features:             number
}

export interface TrainResponse extends MetaInfo {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export const api = {
  livePrice:      () => get<LivePrice>('/live-price'),
  predict:        (n = 200) => get<PredictResponse>(`/predict?n=${n}`),
  nextPrediction: () => get<NextPrediction>('/next-prediction'),
  backtest:       () => get<any>('/backtest'),
  train: () =>
    fetch(`${BASE}/train`, {
      method: 'POST',
      signal: AbortSignal.timeout(600000),
    }).then(r => {
      if (!r.ok) throw new Error(`Train error ${r.status}`)
      return r.json() as Promise<TrainResponse>
    }),
}
