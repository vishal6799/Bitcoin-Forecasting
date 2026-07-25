# Bitcoin-Forecasting
Built an AI-powered Bitcoin forecasting system using stacked LSTM trained on 200K+ OHLCV data, achieving ~82% accuracy. Enhanced performance with technical indicators, improving results by ~18%. Developed a FastAPI backend and Next.js dashboard with real-time price tracking, predictions, and trading signals.
# ₿ BTC Oracle — Full-Stack AI Forecasting App

> Next.js 14 + FastAPI + LSTM + Technical Indicators

🗂️ Project Structure

```
btc-forecast/
├── backend/          ← Python FastAPI + Keras LSTM
│   ├── main.py
│   ├── requirements.txt
│   └── btc.csv       ← PUT YOUR CSV HERE
└── frontend/         ← Next.js 14 (TypeScript + Tailwind)
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx       ← Main dashboard
    │   │   ├── layout.tsx
    │   │   └── globals.css
    │   ├── components/
    │   │   ├── LiveTicker.tsx
    │   │   ├── PredictionChart.tsx
    │   │   └── TradingSignal.tsx
    │   └── lib/
    │       └── api.ts
    ├── next.config.js
    ├── tailwind.config.js
    └── package.json

⚙️ Setup — Backend (FastAPI)

```bash
cd backend

# 1. Create & activate venv
python -m venv venv
source venv/bin/activate     # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Place your BTC CSV in backend/
cp /path/to/btc.csv .

# 4. Run FastAPI
uvicorn main:app --reload --port 8000
--- 

The API will be live at: **http://localhost:8000**

API docs: **http://localhost:8000/docs**

---

## ⚙️ Setup — Frontend (Next.js)

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Run dev server
npm run dev
```

Frontend: **http://localhost:3000**

---

## 🚀 Using the App

1. Open **http://localhost:3000**
2. The **Live BTC ticker** auto-refreshes every 15 seconds via CoinGecko
3. Click **"Train Model"** — trains LSTM on your btc.csv (takes a few minutes on CPU)
4. Once trained, the chart and signal table populate automatically
5. Click **"Load Predictions"** anytime to reload (uses saved model)

---

## 📡 API Endpoints

| Method | Endpoint        | Description                          |
|--------|-----------------|--------------------------------------|
| GET    | `/`             | Health check                         |
| POST   | `/train`        | Train LSTM on btc.csv                |
| GET    | `/predict?n=N`  | Get last N actual vs predicted prices |
| GET    | `/live-price`   | Live BTC/USD from CoinGecko          |
| GET    | `/backtest`     | Simple P&L backtest on signals       |

---

## 🧠 Model Architecture

```
Input: (60, 12)  ← 60-bar sequences × 12 features
│
├── LSTM(64, return_sequences=True)
├── Dropout(0.2)
├── LSTM(64)
├── Dropout(0.2)
├── Dense(32)
└── Dense(1)  → predicted Close price
```

**Features**: Open, High, Low, Close, Volume, SMA_10, SMA_50, EMA_10, RSI, MACD, BB_upper, BB_lower

---

## 📝 CSV Format Expected

Your `btc.csv` should have at minimum these columns:

```
Open,High,Low,Close,Volume
```

The model uses `df.tail(200000)` for memory efficiency.

---

## 🏆 Resume Description

> Built a full-stack AI Bitcoin forecasting platform using Next.js 14 and FastAPI, featuring an LSTM deep learning model with technical indicators (RSI, MACD, Bollinger Bands), live price streaming, trading signal generation, and an interactive dark-themed dashboard.

---

## ⚠️ Disclaimer

This project is for educational purposes only. Not financial advice.
