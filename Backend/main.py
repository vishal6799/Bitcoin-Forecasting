from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler, RobustScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, accuracy_score
from sklearn.utils.class_weight import compute_class_weight
import tensorflow as tf
from tensorflow.keras.models import Model, load_model
from tensorflow.keras.layers import (
    Input, LSTM, Bidirectional, Dense, Dropout,
    GlobalAveragePooling1D, LayerNormalization, Conv1D,
    MaxPooling1D, Flatten, concatenate, BatchNormalization
)
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.optimizers import Adam
import os, httpx, joblib, json
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="BTC Oracle — Ensemble Trading API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Config ───────────────────────────────────────────────────────────────────
COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY", "")
CSV_PATH   = "btc_daily.csv"
SEQ_LEN    = 20
CLOSE_IDX  = 3

FEATURE_COLS = [
    # Price
    'Open', 'High', 'Low', 'Close', 'Volume',
    # Trend
    'SMA_7', 'SMA_21', 'SMA_50', 'EMA_9', 'EMA_21',
    'SMA_cross',        # SMA_7 / SMA_21 crossover signal
    # Momentum
    'RSI', 'RSI_slope',
    'MACD', 'MACD_Signal', 'MACD_Hist',
    'Stoch_K', 'Stoch_D',
    # Volatility
    'BB_upper', 'BB_lower', 'BB_width', 'BB_pct',
    'ATR', 'ATR_pct',
    # Volume
    'OBV_norm', 'Volume_ratio',
    # Price patterns
    'HL_ratio', 'OC_ratio',
    'Return_1d', 'Return_3d', 'Return_7d', 'Return_14d',
    # Regime
    'Above_SMA50', 'Price_vs_BB',
]

reg_model  = None   # Regression model  → predicts price
clf_model  = None   # Classification model → predicts UP/DOWN
reg_scaler = None
clf_scaler = None
meta       = {}

# ─── Feature Engineering ──────────────────────────────────────────────────────
def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # Trend
    df['SMA_7']    = df['Close'].rolling(7).mean()
    df['SMA_21']   = df['Close'].rolling(21).mean()
    df['SMA_50']   = df['Close'].rolling(50).mean()
    df['EMA_9']    = df['Close'].ewm(span=9,  adjust=False).mean()
    df['EMA_21']   = df['Close'].ewm(span=21, adjust=False).mean()
    df['SMA_cross']= (df['SMA_7'] / df['SMA_21']) - 1  # + means bullish cross

    # RSI
    delta      = df['Close'].diff()
    gain       = delta.where(delta > 0, 0).rolling(14).mean()
    loss       = (-delta.where(delta < 0, 0)).rolling(14).mean()
    df['RSI']  = 100 - (100 / (1 + gain / loss))
    df['RSI_slope'] = df['RSI'].diff(3)   # RSI momentum

    # MACD
    ema12 = df['Close'].ewm(span=12, adjust=False).mean()
    ema26 = df['Close'].ewm(span=26, adjust=False).mean()
    df['MACD']        = ema12 - ema26
    df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
    df['MACD_Hist']   = df['MACD'] - df['MACD_Signal']

    # Stochastic
    low14  = df['Low'].rolling(14).min()
    high14 = df['High'].rolling(14).max()
    df['Stoch_K'] = 100 * (df['Close'] - low14) / (high14 - low14 + 1e-10)
    df['Stoch_D'] = df['Stoch_K'].rolling(3).mean()

    # Bollinger Bands
    sma20 = df['Close'].rolling(20).mean()
    std20 = df['Close'].rolling(20).std()
    df['BB_upper'] = sma20 + 2 * std20
    df['BB_lower'] = sma20 - 2 * std20
    df['BB_width'] = (df['BB_upper'] - df['BB_lower']) / (sma20 + 1e-10)
    df['BB_pct']   = (df['Close'] - df['BB_lower']) / (df['BB_upper'] - df['BB_lower'] + 1e-10)

    # ATR
    hl  = df['High'] - df['Low']
    hc  = (df['High'] - df['Close'].shift()).abs()
    lc  = (df['Low']  - df['Close'].shift()).abs()
    tr  = pd.concat([hl, hc, lc], axis=1).max(axis=1)
    df['ATR']     = tr.rolling(14).mean()
    df['ATR_pct'] = df['ATR'] / df['Close']

    # OBV (normalised)
    obv = [0]
    for i in range(1, len(df)):
        if df['Close'].iloc[i] > df['Close'].iloc[i-1]:
            obv.append(obv[-1] + df['Volume'].iloc[i])
        elif df['Close'].iloc[i] < df['Close'].iloc[i-1]:
            obv.append(obv[-1] - df['Volume'].iloc[i])
        else:
            obv.append(obv[-1])
    df['OBV']        = obv
    df['OBV_norm']   = df['OBV'] / (df['OBV'].abs().rolling(20).mean() + 1e-10)
    df['Volume_ratio'] = df['Volume'] / (df['Volume'].rolling(20).mean() + 1e-10)

    # Price ratios
    df['HL_ratio']   = (df['High'] - df['Low']) / (df['Close'] + 1e-10)
    df['OC_ratio']   = (df['Close'] - df['Open']) / (df['Open'] + 1e-10)

    # Returns
    df['Return_1d']  = df['Close'].pct_change(1)
    df['Return_3d']  = df['Close'].pct_change(3)
    df['Return_7d']  = df['Close'].pct_change(7)
    df['Return_14d'] = df['Close'].pct_change(14)

    # Regime
    df['Above_SMA50']  = (df['Close'] > df['SMA_50']).astype(float)
    df['Price_vs_BB']  = df['BB_pct']

    df.replace([np.inf, -np.inf], np.nan, inplace=True)
    df.dropna(inplace=True)
    return df


def load_and_prepare(csv_path=CSV_PATH):
    df = pd.read_csv(csv_path)
    df['Date'] = pd.to_datetime(df['Date'])
    df.sort_values('Date', inplace=True)
    df.set_index('Date', inplace=True)
    df = df[['Open','High','Low','Close','Volume']].apply(pd.to_numeric, errors='coerce')
    df = df[(df['Close'] > 0) & (df['Volume'] > 0)]
    df.dropna(inplace=True)
    df = add_features(df)
    return df


def create_reg_sequences(scaled, seq_len=SEQ_LEN):
    X, y = [], []
    for i in range(len(scaled) - seq_len):
        X.append(scaled[i:i+seq_len])
        y.append(scaled[i+seq_len][CLOSE_IDX])
    return np.array(X), np.array(y)


def create_clf_sequences(features, labels, seq_len=SEQ_LEN):
    X, y = [], []
    for i in range(len(features) - seq_len):
        X.append(features[i:i+seq_len])
        y.append(labels[i+seq_len])
    return np.array(X), np.array(y)


def inverse_close(values, sc):
    dummy = np.zeros((len(values), len(FEATURE_COLS)))
    dummy[:, CLOSE_IDX] = values.flatten()
    return sc.inverse_transform(dummy)[:, CLOSE_IDX]


# ─── Model 1: Regression (CNN + LSTM) ─────────────────────────────────────────
def build_regression_model(seq_len, n_features):
    inp = Input(shape=(seq_len, n_features))

    # CNN branch — captures local patterns
    c = Conv1D(64, kernel_size=3, activation='relu', padding='same')(inp)
    c = BatchNormalization()(c)
    c = Conv1D(32, kernel_size=3, activation='relu', padding='same')(c)
    c = GlobalAveragePooling1D()(c)

    # LSTM branch — captures sequential dependencies
    x = Bidirectional(LSTM(64, return_sequences=True))(inp)
    x = LayerNormalization()(x)
    x = Dropout(0.3)(x)
    x = Bidirectional(LSTM(32, return_sequences=False))(x)
    x = LayerNormalization()(x)
    x = Dropout(0.3)(x)

    # Merge
    merged = concatenate([c, x])
    out    = Dense(64, activation='relu')(merged)
    out    = Dropout(0.2)(out)
    out    = Dense(32, activation='relu')(out)
    out    = Dense(1)(out)

    m = Model(inp, out)
    m.compile(optimizer=Adam(0.0005), loss='huber', metrics=['mae'])
    return m


# ─── Model 2: Classification (BiLSTM) ─────────────────────────────────────────
def build_classification_model(seq_len, n_features):
    inp = Input(shape=(seq_len, n_features))

    x = Bidirectional(LSTM(64, return_sequences=True))(inp)
    x = LayerNormalization()(x)
    x = Dropout(0.35)(x)
    x = Bidirectional(LSTM(32, return_sequences=False))(x)
    x = LayerNormalization()(x)
    x = Dropout(0.35)(x)
    x = Dense(64, activation='relu')(x)
    x = Dropout(0.25)(x)
    x = Dense(32, activation='relu')(x)
    out = Dense(1, activation='sigmoid')(x)   # binary: 1=UP, 0=DOWN

    m = Model(inp, out)
    m.compile(
        optimizer=Adam(0.0003),
        loss='binary_crossentropy',
        metrics=['accuracy', tf.keras.metrics.AUC(name='auc')]
    )
    return m


# ─── Startup ──────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    global reg_model, clf_model, reg_scaler, clf_scaler, meta
    if (os.path.exists("reg_model.keras") and os.path.exists("clf_model.keras")
            and os.path.exists("reg_scaler.pkl") and os.path.exists("clf_scaler.pkl")):
        reg_model  = load_model("reg_model.keras")
        clf_model  = load_model("clf_model.keras")
        reg_scaler = joblib.load("reg_scaler.pkl")
        clf_scaler = joblib.load("clf_scaler.pkl")
        if os.path.exists("meta.json"):
            with open("meta.json") as f: meta = json.load(f)
        print("✅ Loaded ensemble models.")
    else:
        print("ℹ️  No saved models. Click Train Model.")


# ─── Routes ───────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "BTC Oracle Ensemble API", "models_loaded": reg_model is not None}


@app.post("/train")
def train():
    global reg_model, clf_model, reg_scaler, clf_scaler, meta

    if not os.path.exists(CSV_PATH):
        raise HTTPException(404, f"{CSV_PATH} not found. Place btc_daily.csv in backend folder.")
    try:
        print("📊 Loading combined BTC data (2014–2026)...")
        df = load_and_prepare(CSV_PATH)
        print(f"✅ {len(df)} rows | {df.index[0].date()} → {df.index[-1].date()}")
        print(f"   Price: ${df['Close'].min():,.0f} → ${df['Close'].max():,.0f}")

        # ── Regression scaler (MinMax for price prediction) ──
        rs = MinMaxScaler()
        reg_scaled = rs.fit_transform(df[FEATURE_COLS])

        # ── Classification scaler (RobustScaler — handles outliers better) ──
        cs = RobustScaler()
        clf_scaled = cs.fit_transform(df[FEATURE_COLS])

        # ── Direction labels: 1 if next day close > today close ──
        closes  = df['Close'].values
        # Pad with 0 at end to match closes length
        dir_labels = np.append((closes[1:] > closes[:-1]).astype(int), 0)

        # ── Sequences ──
        X_reg, y_reg = create_reg_sequences(reg_scaled, SEQ_LEN)
        X_clf, y_clf = create_clf_sequences(clf_scaled, dir_labels, SEQ_LEN)

        # Align lengths
        n = min(len(X_reg), len(X_clf))
        X_reg, y_reg = X_reg[:n], y_reg[:n]
        X_clf, y_clf = X_clf[:n], y_clf[:n]

        split = int(0.8 * n)
        Xr_tr, yr_tr = X_reg[:split], y_reg[:split]
        Xr_te, yr_te = X_reg[split:], y_reg[split:]
        Xc_tr, yc_tr = X_clf[:split], y_clf[:split]
        Xc_te, yc_te = X_clf[split:], y_clf[split:]

        callbacks_reg = [
            EarlyStopping(monitor='val_loss', patience=20, restore_best_weights=True, verbose=1),
            ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=8, min_lr=1e-6, verbose=1),
        ]
        callbacks_clf = [
            EarlyStopping(monitor='val_auc', patience=25, restore_best_weights=True, verbose=1, mode='max'),
            ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=8, min_lr=1e-6, verbose=1),
        ]

        # Class weights to handle imbalance
        cw = compute_class_weight('balanced', classes=np.unique(yc_tr), y=yc_tr)
        class_weight = {0: cw[0], 1: cw[1]}

        # ── Train Regression Model ──
        print("\n🧠 Training Regression Model (CNN + BiLSTM)...")
        rm = build_regression_model(SEQ_LEN, len(FEATURE_COLS))
        rm.fit(Xr_tr, yr_tr, epochs=150, batch_size=16,
               validation_data=(Xr_te, yr_te), callbacks=callbacks_reg, verbose=1)

        # ── Train Classification Model ──
        print("\n🧠 Training Classification Model (BiLSTM)...")
        cm = build_classification_model(SEQ_LEN, len(FEATURE_COLS))
        # Label smoothing helps prevent overconfidence
        yc_tr_smooth = yc_tr * 0.9 + 0.05
        cm.fit(Xc_tr, yc_tr_smooth, epochs=150, batch_size=16,
               validation_data=(Xc_te, yc_te), callbacks=callbacks_clf,
               class_weight=class_weight, verbose=1)

        # ── Evaluate ──
        # Regression metrics
        preds_reg  = rm.predict(Xr_te)
        pred_price = inverse_close(preds_reg, rs)
        true_price = inverse_close(yr_te.reshape(-1,1), rs)
        rmse = float(np.sqrt(mean_squared_error(true_price, pred_price)))
        mae  = float(mean_absolute_error(true_price, pred_price))
        mape = float(np.mean(np.abs((true_price - pred_price) / true_price)) * 100)

        # Regression directional accuracy
        reg_dir_pred = np.sign(np.diff(pred_price))
        reg_dir_true = np.sign(np.diff(true_price))
        reg_dir_acc  = float(np.mean(reg_dir_pred == reg_dir_true) * 100)

        # Classification accuracy
        preds_clf = (cm.predict(Xc_te) > 0.5).astype(int).flatten()
        clf_acc   = float(accuracy_score(yc_te, preds_clf) * 100)

        # Ensemble directional accuracy
        # Combine: reg direction + clf prediction → vote
        reg_dir_arr = (np.diff(pred_price) > 0).astype(int)
        n_min = min(len(reg_dir_arr), len(preds_clf[1:]))
        ensemble_vote = ((reg_dir_arr[:n_min] + preds_clf[1:n_min+1]) >= 1).astype(int)
        true_dir      = (np.diff(true_price[:n_min+1]) > 0).astype(int)
        ensemble_acc  = float(np.mean(ensemble_vote == true_dir) * 100)

        # Save
        rm.save("reg_model.keras")
        cm.save("clf_model.keras")
        joblib.dump(rs, "reg_scaler.pkl")
        joblib.dump(cs, "clf_scaler.pkl")

        meta = {
            "rmse": rmse, "mae": mae, "mape": mape,
            "regression_dir_accuracy":    reg_dir_acc,
            "classification_accuracy":    clf_acc,
            "ensemble_dir_accuracy":      ensemble_acc,
            "directional_accuracy":       ensemble_acc,
            "trained_on":   len(df),
            "date_range":   f"{df.index[0].date()} → {df.index[-1].date()}",
            "features":     len(FEATURE_COLS),
            "seq_len":      SEQ_LEN,
        }
        with open("meta.json", "w") as f: json.dump(meta, f)

        reg_model  = rm
        clf_model  = cm
        reg_scaler = rs
        clf_scaler = cs

        print(f"\n✅ Ensemble Training Complete!")
        print(f"   Regression  RMSE:        ${rmse:,.0f}")
        print(f"   Regression  Dir Acc:     {reg_dir_acc:.1f}%")
        print(f"   Classification Acc:      {clf_acc:.1f}%")
        print(f"   Ensemble Dir Accuracy:   {ensemble_acc:.1f}%")
        return meta

    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(500, f"Training error: {str(e)}")


@app.get("/predict")
def predict(n: int = 200):
    if reg_model is None or clf_model is None:
        raise HTTPException(400, "Models not trained.")
    try:
        df         = load_and_prepare(CSV_PATH)
        reg_scaled = reg_scaler.transform(df[FEATURE_COLS])
        clf_scaled = clf_scaler.transform(df[FEATURE_COLS])

        X_reg, y_reg = create_reg_sequences(reg_scaled, SEQ_LEN)
        X_clf, y_clf = create_clf_sequences(
            clf_scaled,
            np.append((df['Close'].values[1:] > df['Close'].values[:-1]).astype(int), 0),
            SEQ_LEN
        )

        n_avail = min(len(X_reg), len(X_clf))
        split   = int(0.8 * n_avail)
        Xr_te   = X_reg[split:]
        Xc_te   = X_clf[split:]
        yr_te   = y_reg[split:]

        n = min(n, len(Xr_te))
        preds_reg  = reg_model.predict(Xr_te[-n:])
        preds_clf  = clf_model.predict(Xc_te[-n:]).flatten()

        predicted = inverse_close(preds_reg, reg_scaler).tolist()
        actual    = inverse_close(yr_te[-n:].reshape(-1,1), reg_scaler).tolist()

        # Ensemble signals — use CLASSIFICATION as primary signal source
        # Regression is used only for price target, not direction
        signals, confidences, stop_losses, take_profits = [], [], [], []
        for i in range(len(predicted)):
            clf_up   = preds_clf[i] > 0.48  # slightly lower threshold to reduce SELL bias
            clf_conf = float(preds_clf[i]) if clf_up else float(1 - preds_clf[i])
            signal   = "BUY" if clf_up else "SELL"
            conf     = clf_conf * 100

            atr = float(df['ATR'].iloc[-(n - i)])
            sl  = round(actual[i] - 1.5 * atr, 2) if signal == "BUY" else round(actual[i] + 1.5 * atr, 2)
            tp  = round(actual[i] + 2.5 * atr, 2) if signal == "BUY" else round(actual[i] - 2.5 * atr, 2)

            signals.append(signal)
            confidences.append(round(min(conf, 99), 1))
            stop_losses.append(sl)
            take_profits.append(tp)

        dates = [str(df.index[-(n-i)].date()) for i in range(n-1, -1, -1)]

        return {
            "actual": actual, "predicted": predicted,
            "signals": signals, "confidences": confidences,
            "stop_losses": stop_losses, "take_profits": take_profits,
            "dates": dates, "meta": meta,
        }
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(500, f"Prediction error: {str(e)}")


@app.get("/next-prediction")
def next_prediction():
    if reg_model is None or clf_model is None:
        raise HTTPException(400, "Models not trained.")
    try:
        df         = load_and_prepare(CSV_PATH)
        reg_scaled = reg_scaler.transform(df[FEATURE_COLS])
        clf_scaled = clf_scaler.transform(df[FEATURE_COLS])

        reg_seq = reg_scaled[-SEQ_LEN:].reshape(1, SEQ_LEN, len(FEATURE_COLS))
        clf_seq = clf_scaled[-SEQ_LEN:].reshape(1, SEQ_LEN, len(FEATURE_COLS))

        pred_reg   = reg_model.predict(reg_seq)
        pred_clf   = float(clf_model.predict(clf_seq)[0][0])
        pred_price = inverse_close(pred_reg, reg_scaler)[0]

        current = float(df['Close'].iloc[-1])
        atr     = float(df['ATR'].iloc[-1])
        delta   = (pred_price - current) / current * 100

        # Use classification model as primary signal
        clf_up   = pred_clf > 0.48
        clf_conf = pred_clf if clf_up else (1 - pred_clf)
        signal   = "BUY" if clf_up else "SELL"
        conf     = clf_conf * 100
        reg_up   = bool(pred_price > current)  # keep for models_agree check

        sl = round(current - 1.5*atr, 2) if signal=="BUY" else round(current + 1.5*atr, 2)
        tp = round(current + 2.5*atr, 2) if signal=="BUY" else round(current - 2.5*atr, 2)

        today    = datetime.utcnow().date()
        tomorrow = today + timedelta(days=1)

        return {
            "date":              str(tomorrow),
            "as_of":             str(today),
            "current_price":     round(current, 2),
            "predicted_price":   round(float(pred_price), 2),
            "delta_pct":         round(delta, 2),
            "signal":            signal,
            "confidence":        round(min(conf, 99), 1),
            "stop_loss":         sl,
            "take_profit":       tp,
            "rsi":               round(float(df['RSI'].iloc[-1]), 1),
            "macd":              round(float(df['MACD'].iloc[-1]), 2),
            "atr":               round(atr, 2),
            "clf_probability":   round(pred_clf * 100, 1),
            "reg_prediction":    round(float(pred_price), 2),
            "models_agree":      bool(reg_up == clf_up),
        }
    except Exception as e:
        raise HTTPException(500, f"Prediction error: {str(e)}")


@app.get("/live-price")
async def live_price():
    headers = {"x-cg-demo-api-key": COINGECKO_API_KEY}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "bitcoin", "vs_currencies": "usd",
                        "include_24hr_change": "true"},
                headers=headers)
            d = r.json()["bitcoin"]
            return {"price": d["usd"], "change": d.get("usd_24h_change", 0)}
        except Exception: pass
        try:
            r = await client.get("https://api.binance.com/api/v3/ticker/24hr",
                                 params={"symbol": "BTCUSDT"})
            d = r.json()
            return {"price": float(d["lastPrice"]), "change": float(d["priceChangePercent"])}
        except Exception: pass
        raise HTTPException(502, "Could not fetch live price.")


@app.get("/backtest")
def backtest():
    result  = predict(n=500)
    actual  = result["actual"]
    signals = result["signals"]
    profit  = 0.0; trades = []; wins = 0
    for i in range(1, len(signals)):
        if signals[i-1] == "BUY":
            gain    = actual[i] - actual[i-1]
            profit += gain
            if gain > 0: wins += 1
            trades.append({"index": i, "gain": round(gain,2),
                           "cumulative": round(profit,2), "date": result["dates"][i]})
    return {
        "total_profit": round(profit, 2),
        "total_trades": len(trades),
        "win_rate":     round(wins / max(len(trades),1) * 100, 1),
        "trades":       trades[-50:],
        "meta":         meta,
    }