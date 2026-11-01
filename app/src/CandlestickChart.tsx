import React, { useEffect, useRef, useState, useCallback } from "react";
import { createChart, ISeriesApi, SeriesMarker, Time, IPriceLine } from "lightweight-charts";

interface SignalRecord {
    type: "BUY" | "SELL";
    time: Time;
    price: number;
}

interface TimeframeOption {
    label: string;
    value: string;
    seconds: number;
}

const TIMEFRAMES: TimeframeOption[] = [
    { label: "1m", value: "1m", seconds: 60 },
    { label: "5m", value: "5m", seconds: 300 },
    { label: "15m", value: "15m", seconds: 900 },
    { label: "30m", value: "30m", seconds: 1800 },
    { label: "1h", value: "1h", seconds: 3600 },
    { label: "4h", value: "4h", seconds: 14400 },
    { label: "1d", value: "1d", seconds: 86400 },
    { label: "1w", value: "1w", seconds: 604800 },
    { label: "1M", value: "1M", seconds: 2592000 },
];

interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

interface SymbolOption {
    label: string;
    symbol: string;
    name: string;
    source: "binance" | "yahoo";
}

// crypto & emas lewat Binance; forex & indeks lewat Yahoo (endpoint Deriv history tidak tersedia)
const SYMBOLS: SymbolOption[] = [
    { label: "BTC/USDT", symbol: "BTCUSDT", name: "Bitcoin / USDT", source: "binance" },
    { label: "ETH/USDT", symbol: "ETHUSDT", name: "Ethereum / USDT", source: "binance" },
    { label: "XAU/USDT", symbol: "PAXGUSDT", name: "Gold Spot (XAU)", source: "binance" },
    { label: "EUR/USD", symbol: "EURUSD=X", name: "Euro / US Dollar", source: "yahoo" },
    { label: "GBP/USD", symbol: "GBPUSD=X", name: "Pound / US Dollar", source: "yahoo" },
    { label: "AUD/USD", symbol: "AUDUSD=X", name: "Aussie / US Dollar", source: "yahoo" },
    { label: "USD/JPY", symbol: "USDJPY=X", name: "US Dollar / Japanese Yen", source: "yahoo" },
    { label: "EUR/JPY", symbol: "EURJPY=X", name: "Euro / Japanese Yen", source: "yahoo" },
    { label: "GBP/JPY", symbol: "GBPJPY=X", name: "Pound / Japanese Yen", source: "yahoo" },
    { label: "US500", symbol: "^GSPC", name: "S&P 500 Index", source: "yahoo" },
    { label: "NAS100", symbol: "^NDX", name: "Nasdaq 100 Index", source: "yahoo" },
];

// Hitung Average True Range (ATR) untuk manajemen risiko SL/TP yang adaptif
// (perbaikan win rate untuk Gold / Forex major yang volat-nya lebih tinggi)
const calculateATR = (data: Candle[], period: number = 14): number => {
    const trueRanges: number[] = [];
    for (let i = 1; i < data.length; i++) {
        const tr = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - data[i - 1].close),
            Math.abs(data[i].low - data[i - 1].close)
        );
        trueRanges.push(tr);
    }
    if (trueRanges.length === 0) {
        const last = data[data.length - 1];
        return last ? (last.high - last.low) || 0.0001 : 0.0001;
    }
    const n = Math.min(period, trueRanges.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += trueRanges[i];
    return sum / n;
};

const secondsOf = (interval: string): number =>
    TIMEFRAMES.find((t) => t.value === interval)?.seconds ?? 3600;

// data-api.binance.com tidak bisa diakses dari banyak jaringan; vision adalah host publik
// resmi untuk data historis, dan /api/binance adalah proxy dev (lihat setupProxy.js)
const BINANCE_ENDPOINTS = ["https://data-api.binance.vision", "/api/binance"];

// nama interval Yahoo berbeda dari Binance, dan 4h tidak tersedia (agregasi dari 1h)
const YAHOO_INTERVAL: Record<string, string> = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "1h",
    "4h": "1h", "1d": "1d", "1w": "1wk", "1M": "1mo",
};

const fetchBinanceCandles = async (symbol: string, interval: string, limit: number): Promise<Candle[]> => {
    let lastError: unknown = null;
    for (const endpoint of BINANCE_ENDPOINTS) {
        try {
            const res = await fetch(`${endpoint}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
            if (!res.ok) throw new Error(`Binance ${res.status}`);
            const data = await res.json();
            if (!Array.isArray(data)) throw new Error(String(data?.msg || "Respons Binance bukan daftar candle"));
            return data.map((d: any) => ({
                time: Math.floor(d[0] / 1000),
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4]),
            }));
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError;
};

const fetchYahooCandles = async (symbol: string, interval: string, limit: number): Promise<Candle[]> => {
    const spanSeconds = secondsOf(interval) * limit;
    const now = Math.floor(Date.now() / 1000);
    const reqInterval = YAHOO_INTERVAL[interval] ?? "1h";
    const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}` +
        `?interval=${reqInterval}&period1=${now - spanSeconds}&period2=${now}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Yahoo ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(json?.chart?.error?.description || "Yahoo tidak mengembalikan data");
    const stamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const candles: Candle[] = [];
    for (let i = 0; i < stamps.length; i++) {
        const open = quote.open?.[i], high = quote.high?.[i], low = quote.low?.[i], close = quote.close?.[i];
        // bar terakhir sering null saat pasar sedang tutup
        if (!stamps[i] || open == null || high == null || low == null || close == null) continue;
        candles.push({ time: stamps[i], open, high, low, close });
    }
    return aggregateCandles(candles, secondsOf(interval));
};

const aggregateCandles = (candles: Candle[], bucketSeconds: number): Candle[] => {
    const buckets = new Map<number, Candle>();
    for (const c of candles) {
        const key = Math.floor(c.time / bucketSeconds) * bucketSeconds;
        const prev = buckets.get(key);
        if (!prev) {
            buckets.set(key, { ...c, time: key });
        } else {
            prev.high = Math.max(prev.high, c.high);
            prev.low = Math.min(prev.low, c.low);
            prev.close = c.close;
        }
    }
    return [...buckets.values()];
};

// lightweight-charts menolak data yang duplikat atau tidak urut waktu
const normalizeCandles = (candles: Candle[]): Candle[] => {
    const byTime = new Map<number, Candle>();
    for (const c of candles) {
        if ([c.open, c.high, c.low, c.close].every(Number.isFinite)) byTime.set(c.time, c);
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
};

const fetchCandles = async (sym: SymbolOption, interval: string, limit: number = 200): Promise<Candle[]> => {
    const raw = sym.source === "yahoo"
        ? await fetchYahooCandles(sym.symbol, interval, limit)
        : await fetchBinanceCandles(sym.symbol, interval, limit);
    return normalizeCandles(raw).slice(-limit);
};

interface BacktestResult {
    timeframe: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winrate: number;
    totalR: number;
    profitFactor: number;
    avgWinR: number;
    avgLossR: number;
    expectancy: number;
}

const CandlestickChart = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const emaRef = useRef<any>(null);
  const tenkanRef = useRef<any>(null);
  const kijunRef = useRef<any>(null);
  const senkaARef = useRef<any>(null);
  const senkaBRef = useRef<any>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const fittedBandRef = useRef<{ min: number; max: number } | null>(null);
  const lastPayloadRef = useRef<string>("");
  const renderRef = useRef<any>(null);
  
  const [timeframe, setTimeframe] = useState<typeof TIMEFRAMES[number]>(TIMEFRAMES[5]); // default 4h
  const timeframeValueRef = useRef(timeframe.value);
  useEffect(() => { timeframeValueRef.current = timeframe.value; }, [timeframe.value]);

  const [selectedSymbol, setSelectedSymbol] = useState<SymbolOption>(SYMBOLS[0]); // default BTC/USDT

  const [chartError, setChartError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);

  // --- Timer candle (countdown sampai candle berikutnya mulai/berakhir) ---
  const [timeLeft, setTimeLeft] = useState(timeframe.seconds);
  useEffect(() => {
    const updateTimer = () => {
      const now = Date.now();
      const seconds = timeframe.seconds - (Math.floor(now / 1000) % timeframe.seconds);
      setTimeLeft(seconds);
    };
    updateTimer();
    const timerInterval = setInterval(updateTimer, 1000);
    return () => clearInterval(timerInterval);
  }, [timeframe]);

  const formatCountdown = (totalSeconds: number) => {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  // --- Backtest state ---
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);
  const [isBacktesting, setIsBacktesting] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  // ==================== HITUNG INDIKATOR & SINYAL ====================
  const calculateIndicators = useCallback((formattedData: any[], seconds: number) => {
    const displacement = seconds * 26;

    // EMA 20
    const emaPeriod = 20;
    const k = 2 / (emaPeriod + 1);
    let emaData: { time: Time; value: number }[] = [];
    let prevEma = formattedData[0].close;
    emaData.push({ time: formattedData[0].time as Time, value: prevEma });
    for (let i = 1; i < formattedData.length; i++) {
      const currentEma = (formattedData[i].close - prevEma) * k + prevEma;
      emaData.push({ time: formattedData[i].time as Time, value: currentEma });
      prevEma = currentEma;
    }
    const getEmaAt = (index: number) => emaData[index]?.value;

    // Ichimoku
    let tenkanData: { time: Time; value: number }[] = [];
    let kijunData: { time: Time; value: number }[] = [];
    let senkouAData: { time: Time; value: number }[] = [];
    let senkouBData: { time: Time; value: number }[] = [];

    for (let i = 0; i < formattedData.length; i++) {
      if (i >= 8) {
        const high = Math.max(...formattedData.slice(i - 8, i + 1).map((d: any) => d.high));
        const low = Math.min(...formattedData.slice(i - 8, i + 1).map((d: any) => d.low));
        tenkanData.push({ time: formattedData[i].time as Time, value: (high + low) / 2 });
      }
      if (i >= 25) {
        const high = Math.max(...formattedData.slice(i - 25, i + 1).map((d: any) => d.high));
        const low = Math.min(...formattedData.slice(i - 25, i + 1).map((d: any) => d.low));
        kijunData.push({ time: formattedData[i].time as Time, value: (high + low) / 2 });
      }
      if (i >= 51) {
        const high = Math.max(...formattedData.slice(i - 51, i + 1).map((d: any) => d.high));
        const low = Math.min(...formattedData.slice(i - 51, i + 1).map((d: any) => d.low));
        senkouBData.push({ time: (formattedData[i].time + displacement) as Time, value: (high + low) / 2 });
      }
    }

    for (let i = 25; i < formattedData.length; i++) {
      const t = tenkanData.find((d: any) => d.time === formattedData[i].time);
      const k = kijunData.find((d: any) => d.time === formattedData[i].time);
      if (t && k) {
        senkouAData.push({ time: (formattedData[i].time + displacement) as Time, value: (t.value + k.value) / 2 });
      }
    }

    senkouAData.sort((a, b) => (a.time as number) - (b.time as number));
    senkouBData.sort((a, b) => (a.time as number) - (b.time as number));

    const getCloudAt = (index: number) => {
      const baseIndex = index - 26;
      if (baseIndex < 0) return null;
      const targetTime = formattedData[baseIndex].time + displacement;
      const a = senkouAData.find((d: any) => d.time === targetTime)?.value;
      const b = senkouBData.find((d: any) => d.time === targetTime)?.value;
      if (a === undefined || b === undefined) return null;
      return { upper: Math.max(a, b), lower: Math.min(a, b) };
    };

    // Sinyal
    const signals: { type: "BUY" | "SELL"; index: number; price: number; time: Time }[] = [];
    let currentState = "NONE";
    let lastSignalIndex = -1;
    const COOLDOWN = 5;

    for (let i = 26; i < formattedData.length; i++) {
      if (i - lastSignalIndex < COOLDOWN) continue;

      const currentCandle = formattedData[i];
      const currentEma = getEmaAt(i);
      const prevEma = getEmaAt(i - 1);
      const cloud = getCloudAt(i);

      const tenkanAtI = tenkanData.find((d: any) => d.time === currentCandle.time)?.value;
      const kijunAtI = kijunData.find((d: any) => d.time === currentCandle.time)?.value;

      if (!currentEma || !prevEma || !cloud || tenkanAtI === undefined || kijunAtI === undefined) continue;

      const { upper: kumoUpper, lower: kumoLower } = cloud;
      const close = currentCandle.close;

      const emaRising = currentEma > prevEma;
      const emaFalling = currentEma < prevEma;
      const cloudBullish = tenkanAtI > kijunAtI;
      const cloudBearish = tenkanAtI < kijunAtI;

      const isBuyCondition = close > currentEma && close > kumoUpper && emaRising && cloudBullish;
      const isSellCondition = close < currentEma && close < kumoLower && emaFalling && cloudBearish;

      let newState = "NONE";
      if (isBuyCondition) newState = "BUY";
      else if (isSellCondition) newState = "SELL";

      if (newState !== currentState && newState !== "NONE") {
        signals.push({ type: newState as "BUY" | "SELL", index: i, price: close, time: currentCandle.time as Time });
        currentState = newState;
        lastSignalIndex = i;
      }
    }

    return { emaData, getEmaAt, tenkanData, kijunData, senkouAData, senkouBData, getCloudAt, signals };
  }, []);

  // ==================== RENDER CHART ====================
  const renderData = useCallback((formattedData: Candle[], fit: boolean) => {
    const chart = chartRef.current;
    const candlestickSeries = seriesRef.current;
    const emaSeries = emaRef.current!;
    const tenkanSeries = tenkanRef.current!;
    const kijunSeries = kijunRef.current!;
    const senkouASeries = senkaARef.current!;
    const senkouBSeries = senkaBRef.current!;

    // chart sudah dibuang (unmount / StrictMode remount) atau data tidak tersedia
    if (!chart || !candlestickSeries || formattedData.length === 0) return;

    const seconds = secondsOf(timeframeValueRef.current ?? "4h");

    const dataMin = Math.min(...formattedData.map((d) => d.low));
    const dataMax = Math.max(...formattedData.map((d) => d.high));
    const band = fittedBandRef.current;
    // auto-scale mati saat refresh biasa; dinyalakan lagi kalau pair/timeframe berganti atau
    // harga keluar dari area yang terkunci, supaya candle tidak hilang dari layar
    const rescalePrice = fit || !band || dataMin < band.min || dataMax > band.max;
    candlestickSeries.priceScale().applyOptions({ autoScale: rescalePrice });

    // setData menggeser rentang waktu yang tampak; simpan agar refresh berkala tidak merusak zoom
    const visibleRange = fit ? null : chart.timeScale().getVisibleLogicalRange();

    candlestickSeries.setData(formattedData as any);

    // EMA 20
    const emaPeriod = 20;
    const k = 2 / (emaPeriod + 1);
    let emaData: { time: Time; value: number }[] = [];
    let prevEma = formattedData[0].close;
    emaData.push({ time: formattedData[0].time as Time, value: prevEma });
    for (let i = 1; i < formattedData.length; i++) {
      const currentEma = (formattedData[i].close - prevEma) * k + prevEma;
      emaData.push({ time: formattedData[i].time as Time, value: currentEma });
      prevEma = currentEma;
    }
    emaSeries.setData(emaData);
    const getEmaAt = (index: number) => emaData[index]?.value;

    // Ichimoku
    const displacement = seconds * 26;
    let tenkanData: { time: Time; value: number }[] = [];
    let kijunData: { time: Time; value: number }[] = [];
    let senkouAData: { time: Time; value: number }[] = [];
    let senkouBData: { time: Time; value: number }[] = [];

    for (let i = 0; i < formattedData.length; i++) {
      if (i >= 8) {
        const high = Math.max(...formattedData.slice(i - 8, i + 1).map((d: any) => d.high));
        const low = Math.min(...formattedData.slice(i - 8, i + 1).map((d: any) => d.low));
        tenkanData.push({ time: formattedData[i].time as Time, value: (high + low) / 2 });
      }
      if (i >= 25) {
        const high = Math.max(...formattedData.slice(i - 25, i + 1).map((d: any) => d.high));
        const low = Math.min(...formattedData.slice(i - 25, i + 1).map((d: any) => d.low));
        kijunData.push({ time: formattedData[i].time as Time, value: (high + low) / 2 });
      }
      if (i >= 51) {
        const high = Math.max(...formattedData.slice(i - 51, i + 1).map((d: any) => d.high));
        const low = Math.min(...formattedData.slice(i - 51, i + 1).map((d: any) => d.low));
        senkouBData.push({ time: (formattedData[i].time + displacement) as Time, value: (high + low) / 2 });
      }
    }
    for (let i = 25; i < formattedData.length; i++) {
      const t = tenkanData.find((d: any) => d.time === formattedData[i].time);
      const k = kijunData.find((d: any) => d.time === formattedData[i].time);
      if (t && k) {
        senkouAData.push({ time: (formattedData[i].time + displacement) as Time, value: (t.value + k.value) / 2 });
      }
    }
    senkouAData.sort((a, b) => (a.time as number) - (b.time as number));
    senkouBData.sort((a, b) => (a.time as number) - (b.time as number));

    tenkanSeries.setData(tenkanData);
    kijunSeries.setData(kijunData);
    senkouASeries.setData(senkouAData);
    senkouBSeries.setData(senkouBData);

    const getCloudAt = (index: number) => {
      const baseIndex = index - 26;
      if (baseIndex < 0) return null;
      const targetTime = formattedData[baseIndex].time + displacement;
      const a = senkouAData.find((d: any) => d.time === targetTime)?.value;
      const b = senkouBData.find((d: any) => d.time === targetTime)?.value;
      if (a === undefined || b === undefined) return null;
      return { upper: Math.max(a, b), lower: Math.min(a, b) };
    };

    // Sinyal chart
    const markers: SeriesMarker<Time>[] = [];
    const signalResults: SignalRecord[] = [];
    let currentState = "NONE";
    let lastSignalIndex = -1;
    const COOLDOWN = 5;

    for (let i = 26; i < formattedData.length; i++) {
      if (i - lastSignalIndex < COOLDOWN) continue;
      const currentCandle = formattedData[i];
      const currentEma = getEmaAt(i);
      const prevEma = getEmaAt(i - 1);
      const cloud = getCloudAt(i);
      const tenkanAtI = tenkanData.find((d: any) => d.time === currentCandle.time)?.value;
      const kijunAtI = kijunData.find((d: any) => d.time === currentCandle.time)?.value;
      if (!currentEma || !prevEma || !cloud || tenkanAtI === undefined || kijunAtI === undefined) continue;

      const { upper: kumoUpper, lower: kumoLower } = cloud;
      const close = currentCandle.close;
      const emaRising = currentEma > prevEma;
      const emaFalling = currentEma < prevEma;
      const cloudBullish = tenkanAtI > kijunAtI;
      const cloudBearish = tenkanAtI < kijunAtI;

      const isBuyCondition = close > currentEma && close > kumoUpper && emaRising && cloudBullish;
      const isSellCondition = close < currentEma && close < kumoLower && emaFalling && cloudBearish;

      let newState = "NONE";
      if (isBuyCondition) newState = "BUY";
      else if (isSellCondition) newState = "SELL";

      if (newState !== currentState && newState !== "NONE") {
        markers.push({
          time: currentCandle.time as Time,
          position: newState === "BUY" ? "belowBar" : "aboveBar",
          color: newState === "BUY" ? "#26a69a" : "#ef5350",
          shape: newState === "BUY" ? "arrowUp" : "arrowDown",
          text: newState === "BUY" ? "Buy" : "Sell",
        });
        signalResults.push({ type: newState as "BUY" | "SELL", time: currentCandle.time as Time, price: close });
        currentState = newState;
        lastSignalIndex = i;
      }
    }
    candlestickSeries.setMarkers(markers);

    // Entry / SL / TP lines
    priceLinesRef.current.forEach((line) => candlestickSeries.removePriceLine(line));
    priceLinesRef.current = [];

    const lastSignal = signalResults.length > 0 ? signalResults[signalResults.length - 1] : null;
    if (lastSignal) {
      const signalIndex = formattedData.findIndex((d: { time: number }) => d.time === lastSignal.time);
      if (signalIndex !== -1) {
        const entryPrice = lastSignal.price;
        const cloud = getCloudAt(signalIndex);
        if (cloud) {
          if (lastSignal.type === "BUY") {
            const atr = calculateATR(formattedData, 14);
            const slPrice = entryPrice - atr;
            const risk = atr;
            if (risk > 0) {
              const lines = [
                { price: entryPrice, color: "#2962FF", lineWidth: 2, title: "Entry (Buy)" },
                { price: slPrice, color: "#ef5350", lineWidth: 2, title: "SL (Kumo Lower)" },
                { price: entryPrice + risk * 1, color: "#26a69a", lineWidth: 1, title: "TP1 (1:1)" },
                { price: entryPrice + risk * 2, color: "#26a69a", lineWidth: 1, title: "TP2 (1:2)" },
                { price: entryPrice + risk * 3, color: "#26a69a", lineWidth: 2, title: "TP3 (1:3)" },
              ];
              lines.forEach((l) => priceLinesRef.current.push(candlestickSeries.createPriceLine(l as any)));
            }
          } else if (lastSignal.type === "SELL") {
            const atr = calculateATR(formattedData, 14);
            const slPrice = entryPrice + atr;
            const risk = atr;
            if (risk > 0) {
              const lines = [
                { price: entryPrice, color: "#2962FF", lineWidth: 2, title: "Entry (Sell)" },
                { price: slPrice, color: "#ef5350", lineWidth: 2, title: "SL (Kumo Upper)" },
                { price: entryPrice - risk * 1, color: "#26a69a", lineWidth: 1, title: "TP1 (1:1)" },
                { price: entryPrice - risk * 2, color: "#26a69a", lineWidth: 1, title: "TP2 (1:2)" },
                { price: entryPrice - risk * 3, color: "#26a69a", lineWidth: 2, title: "TP3 (1:3)" },
              ];
              lines.forEach((l) => priceLinesRef.current.push(candlestickSeries.createPriceLine(l as any)));
            }
          }
        }
      }
    }

    if (fit) {
      chart.timeScale().fitContent();
    } else if (visibleRange) {
      chart.timeScale().setVisibleLogicalRange(visibleRange);
    }
    if (rescalePrice) fittedBandRef.current = { min: dataMin, max: dataMax };
  }, []);

  renderRef.current = renderData;

  // ==================== BUAT CHART (once) ====================
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 550,
      layout: { background: { color: "#ffffff" }, textColor: "#333" },
      grid: { vertLines: { color: "#f0f3fa" }, horzLines: { color: "#f0f3fa" } },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: true, secondsVisible: false },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#26a69a", downColor: "#ef5350", borderVisible: false,
      wickUpColor: "#26a69a", wickDownColor: "#ef5350",
    });
    const emaSeries = chart.addLineSeries({ color: "#FFD700", lineWidth: 2, title: "EMA 20" });
    const tenkanSeries = chart.addLineSeries({ color: "#2962FF", lineWidth: 1, title: "Tenkan (9)" });
    const kijunSeries = chart.addLineSeries({ color: "#ef5350", lineWidth: 1, title: "Kijun (26)" });
    const senkouASeries = chart.addLineSeries({ color: "#4CAF50", lineWidth: 1, title: "Senkou A" });
    const senkouBSeries = chart.addLineSeries({ color: "#FF9800", lineWidth: 1, title: "Senkou B" });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;
    emaRef.current = emaSeries;
    tenkanRef.current = tenkanSeries;
    kijunRef.current = kijunSeries;
    senkaARef.current = senkouASeries;
    senkaBRef.current = senkouBSeries;

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current?.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartRef.current = null;
      seriesRef.current = null;
      priceLinesRef.current = [];
      chart.remove();
    };
  }, []);

  // ==================== MUAT DATA (awal + saat pair/timeframe ganti) ====================
  useEffect(() => {
    let cancelled = false;
    // Yahoo membatasi request yang terlalu sering
    const pollEvery = selectedSymbol.source === "yahoo" ? 30000 : 5000;

    const load = async (fit: boolean) => {
      if (cancelled) return;
      try {
        const data = await fetchCandles(selectedSymbol, timeframe.value);
        if (cancelled) return;
        if (data.length === 0) {
          setChartError(`${selectedSymbol.label} ${timeframe.label}: sumber data tidak mengirim candle.`);
          return;
        }
        setChartError(null);
        setLastSync(Date.now());
        // pasar sedang sepi: candle identik dengan yang sudah digambar, lewati render ulang
        const last = data[data.length - 1];
        const payload = `${data.length}|${last.time}|${last.close}`;
        if (!fit && payload === lastPayloadRef.current) return;
        lastPayloadRef.current = payload;
        renderRef.current(data, fit);
      } catch (err: any) {
        if (!cancelled) {
          setChartError(`Gagal mengambil data ${selectedSymbol.label} (${timeframe.label}): ${err?.message || err}`);
        }
      }
    };

    load(true);
    const fetchInterval = setInterval(() => load(false), pollEvery);
    return () => {
      cancelled = true;
      clearInterval(fetchInterval);
    };
  }, [selectedSymbol, timeframe]);

  // ==================== BACKTEST ====================
  const runBacktestForTimeframe = async (tf: TimeframeOption, sym: SymbolOption): Promise<BacktestResult> => {
    const formattedData = await fetchCandles(sym, tf.value, 500);
    if (formattedData.length < 60) {
      throw new Error(`${sym.label} ${tf.label}: data terlalu sedikit (${formattedData.length} candle)`);
    }

    const { getCloudAt, signals } = calculateIndicators(formattedData, tf.seconds);

    let wins = 0;
    let losses = 0;
    let totalR = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let winRSum = 0;
    let lossRSum = 0;

    for (const sig of signals) {
      const entryPrice = sig.price;
      const cloud = getCloudAt(sig.index);
      if (!cloud) continue;

      const { upper: kumoUpper, lower: kumoLower } = cloud;
      let resultR = 0;
      let hit = false;

      // Scan forward candles for SL / TP hit
      for (let j = sig.index + 1; j < formattedData.length; j++) {
        const candle = formattedData[j];

        if (sig.type === "BUY") {
          const risk = calculateATR(formattedData, 14);
          if (risk <= 0) break;
          const tp1 = entryPrice + risk * 1;
          const tp2 = entryPrice + risk * 2;
          const tp3 = entryPrice + risk * 3;

          if (candle.low <= kumoLower) {
            // SL hit
            resultR = -1;
            grossLoss += risk;
            hit = true;
            break;
          }
          if (candle.high >= tp3) {
            resultR = 3;
            grossWin += risk * 3;
            hit = true;
            break;
          }
          if (candle.high >= tp2) {
            resultR = 2;
            grossWin += risk * 2;
            hit = true;
            break;
          }
          if (candle.high >= tp1) {
            resultR = 1;
            grossWin += risk * 1;
            hit = true;
            break;
          }
        } else {
          // SELL
          const risk = calculateATR(formattedData, 14);
          if (risk <= 0) break;
          const tp1 = entryPrice - risk * 1;
          const tp2 = entryPrice - risk * 2;
          const tp3 = entryPrice - risk * 3;

          if (candle.high >= kumoUpper) {
            resultR = -1;
            grossLoss += risk;
            hit = true;
            break;
          }
          if (candle.low <= tp3) {
            resultR = 3;
            grossWin += risk * 3;
            hit = true;
            break;
          }
          if (candle.low <= tp2) {
            resultR = 2;
            grossWin += risk * 2;
            hit = true;
            break;
          }
          if (candle.low <= tp1) {
            resultR = 1;
            grossWin += risk * 1;
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        totalR += resultR;
        if (resultR > 0) {
          wins++;
          winRSum += resultR;
        } else {
          losses++;
          lossRSum += resultR;
        }
      }
    }

    const totalTrades = wins + losses;
    const winrate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;
    const avgWinR = wins > 0 ? winRSum / wins : 0;
    const avgLossR = losses > 0 ? lossRSum / losses : 0;
    const expectancy = totalTrades > 0 ? (wins / totalTrades) * avgWinR + (losses / totalTrades) * avgLossR : 0;

    return {
      timeframe: tf.label,
      totalTrades,
      wins,
      losses,
      winrate,
      totalR,
      profitFactor: profitFactor === Infinity ? 999 : profitFactor,
      avgWinR,
      avgLossR,
      expectancy,
    };
  };

  const runAllBacktests = async () => {
    setIsBacktesting(true);
    setBacktestError(null);
    const results: BacktestResult[] = [];
    const failures: string[] = [];
    for (const tf of TIMEFRAMES) {
      try {
        results.push(await runBacktestForTimeframe(tf, selectedSymbol));
      } catch (err: any) {
        failures.push(tf.label);
        results.push({ timeframe: tf.label, totalTrades: 0, wins: 0, losses: 0, winrate: 0, totalR: 0, profitFactor: 0, avgWinR: 0, avgLossR: 0, expectancy: 0 });
      }
      // array baru, supaya React memicu render ulang tiap baris selesai
      setBacktestResults([...results]);
    }
    if (failures.length) setBacktestError(`Backtest gagal di: ${failures.join(", ")}`);
    setIsBacktesting(false);
  };

  const winrateStatus = (wr: number) => {
    if (wr >= 60) return { label: "BAIK", color: "#26a69a" };
    if (wr >= 40) return { label: "CUKUP", color: "#FF9800" };
    return { label: "RENDAH", color: "#ef5350" };
  };

  return (
    <div style={{ padding: "20px", background: "#fff", borderRadius: "8px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" }}>
      {/* Header & Timeframe selector */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <h2 style={{ fontFamily: "sans-serif", margin: 0, fontSize: "18px" }}>
            {selectedSymbol.label} Ichimoku + EMA 20 Strategy
          </h2>
          <span style={{ background: "#333", color: "#fff", padding: "4px 10px", borderRadius: "12px", fontSize: "14px", fontWeight: "bold", fontFamily: "monospace" }}>
            {timeframe.value.toUpperCase()}
          </span>
          <span style={{ background: "#f0f3fa", color: "#333", padding: "4px 10px", borderRadius: "12px", fontSize: "13px", fontWeight: "bold", fontFamily: "monospace" }}>
            ⏱ {formatCountdown(timeLeft)}
          </span>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid #ddd",
                background: timeframe.value === tf.value ? "#2962FF" : "#fff",
                color: timeframe.value === tf.value ? "#fff" : "#333",
                fontWeight: "600",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Pair selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px", flexBasis: "100%", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "#666" }}>Pair:</span>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {SYMBOLS.map((s) => (
              <button
                key={s.symbol}
                onClick={() => setSelectedSymbol(s)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  border: "1px solid #ddd",
                  background: selectedSymbol.symbol === s.symbol ? "#2962FF" : "#fff",
                  color: selectedSymbol.symbol === s.symbol ? "#fff" : "#333",
                  fontWeight: "600",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Backtest Panel */}
      <div style={{ border: "1px solid #e0e0e0", borderRadius: "8px", padding: "16px", marginBottom: "20px", background: "#fafafa" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
          <button
            onClick={runAllBacktests}
            disabled={isBacktesting}
            style={{
              padding: "8px 16px",
              background: isBacktesting ? "#ccc" : "#2962FF",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontWeight: "600",
              cursor: isBacktesting ? "not-allowed" : "pointer",
            }}
          >
            {isBacktesting ? "Sedang mensimulasi..." : "🔄 Jalankan Backtest Semua Timeframe"}
          </button>
          {backtestError && <span style={{ color: "#ef5350", fontSize: "13px" }}>{backtestError}</span>}
        </div>

        {backtestResults.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #333" }}>
                  <th style={{ padding: "8px", color: "#666" }}>Timeframe</th>
                  <th style={{ padding: "8px", color: "#666", textAlign: "center" }}>Total Trades</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Win</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Loss</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Winrate</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Total R</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Profit Factor</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Avg Win (R)</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Expectancy (R)</th>
                  <th style={{ padding: "8px", textAlign: "center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {backtestResults.map((r) => {
                  const status = winrateStatus(r.winrate);
                  return (
                    <tr key={r.timeframe} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "8px", fontWeight: "600", fontFamily: "monospace" }}>{r.timeframe}</td>
                      <td style={{ padding: "8px", textAlign: "center" }}>{r.totalTrades}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: "#26a69a" }}>{r.wins}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: "#ef5350" }}>{r.losses}</td>
                      <td style={{ padding: "8px", textAlign: "center", fontWeight: "bold" }}>{r.winrate.toFixed(1)}%</td>
                      <td style={{ padding: "8px", textAlign: "center" }}>{r.totalR.toFixed(2)} R</td>
                      <td style={{ padding: "8px", textAlign: "center" }}>{r.profitFactor.toFixed(2)}</td>
                      <td style={{ padding: "8px", textAlign: "center" }}>{r.avgWinR.toFixed(2)}</td>
                      <td style={{ padding: "8px", textAlign: "center" }}>{r.expectancy.toFixed(2)}</td>
                      <td style={{ padding: "8px", textAlign: "center" }}>
                        <span style={{ color: status.color, fontWeight: "bold" }}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!backtestResults.length && !isBacktesting && (
          <p style={{ fontSize: "13px", color: "#666", margin: 0 }}>
            Klik tombol di atas untuk menjalankan simulasi strategi di semua timeframe (1m – 1M).
          </p>
        )}
      </div>

      {chartError && (
        <div style={{ border: "1px solid #ef5350", background: "#fff1f0", color: "#c62828", borderRadius: "6px", padding: "10px 14px", marginBottom: "12px", fontSize: "13px" }}>
          {chartError}
        </div>
      )}
      {!chartError && lastSync && (
        <div style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>
          sinkron terakhir {new Date(lastSync).toLocaleTimeString()} · {selectedSymbol.name} · {selectedSymbol.source === "yahoo" ? "Yahoo Finance" : "Binance"}
        </div>
      )}
      <div ref={chartContainerRef} style={{ width: "100%" }} />
    </div>
  );
};

export default CandlestickChart;
