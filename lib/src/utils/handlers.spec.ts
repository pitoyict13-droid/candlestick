import { generateSignals, calculateSMA, CandlestickDataPoint, Signal } from "./handler";

describe("generateSignals function", () => {
    it("should generate signals", () => {
        const candlestickData: CandlestickDataPoint[] = [];
        // Prices gradually decrease
        for (let i = 1; i <= 120; i++) {
            candlestickData.push({
                closeTime: i,
                close: (1 / i).toString(),
                volume: "100",
            });
        }

        // Prices then increase
        for (let i = 0; i <= 60; i++) {
            candlestickData.push({
                closeTime: i,
                close: (i * 100).toString(),
                volume: "100",
            });
        }

        const signals: Signal[] = generateSignals(candlestickData);
        expect(signals.length).toBeGreaterThan(0);
    });
})

describe("calculateSMA", () => {
    it("should calculate SMA correctly for a given period", () => {
        const candlestickData: CandlestickDataPoint[] = [
            { closeTime: 1, close: "10", volume: "100" },
            { closeTime: 2, close: "15", volume: "150" },
            { closeTime: 3, close: "20", volume: "200" },
        ];
        const period = 3;
        const expectedSMAValues = [(10 + 15 + 20) / 3]; // Expected SMA value for period of 3
        const actualSMAValues = calculateSMA(candlestickData, period);
        expect(actualSMAValues).toEqual(expectedSMAValues);
    });
});
