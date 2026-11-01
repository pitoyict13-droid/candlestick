export interface CandlestickDataPoint {
    closeTime: number;
    close: string;
    volume: string;
}

export interface Signal {
    type: "buy" | "sell";
    timestamp: number;
    price: string;
    volume: string;

}

export function generateSignals(candlestickData: CandlestickDataPoint[]): Signal[] {
    const signals: Signal[] = [];


    const shortPeriod: number = 20;
    const longPeriod: number = 60;

    const shortSMA: number[] = calculateSMA(candlestickData, shortPeriod);
    const longSMA: number[] = calculateSMA(candlestickData, longPeriod);


    for (let i = longPeriod; i < candlestickData.length; i++) {
        const currentShortSMA: number = shortSMA[i];
        const currentLongSMA: number = longSMA[i];
        const previousShortSMA: number = shortSMA[i - 1];
        const previousLongSMA: number = longSMA[i - 1];


        if (currentShortSMA > currentLongSMA && previousShortSMA <= previousLongSMA) {
            signals.push({
                type: "buy",
                timestamp: candlestickData[i].closeTime,
                price: candlestickData[i].close,
                volume: candlestickData[i].volume,
            });
        } else if (currentShortSMA < currentLongSMA && previousShortSMA >= previousLongSMA) {
            signals.push({
                type: "sell",
                timestamp: candlestickData[i].closeTime,
                price: candlestickData[i].close,
                volume: candlestickData[i].volume,
            });
        }
    }

    return signals;
}

// Function that calculates simple moving average (SMA) for a given period
export function calculateSMA(data: CandlestickDataPoint[], period: number): number[] {
    const smaValues: number[] = [];
    for (let i = period - 1; i < data.length; i++) {
        let sum: number = 0;
        for (let j = i; j > i - period; j--) {
            sum += parseFloat(data[j].close.toString());
        }
        smaValues.push(sum / period);
    }
    return smaValues;
}
