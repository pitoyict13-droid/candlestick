import React, {useEffect, useState, useMemo} from "react";
import axios from "axios";
import {generateSignals, Signal} from "../../utils/handler";
import annotationPlugin from "chartjs-plugin-annotation";
import "chartjs-adapter-date-fns";
import {Line} from "react-chartjs-2";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale,
    LineController
} from "chart.js";


ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    TimeScale,
    LineController,
    annotationPlugin,
);

interface CandlestickData {
    close: string;
    closeTime: number;
    volume: string;
}

interface CandlestickChartProps {
    symbol?: string;
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({ symbol = "BTCUSDT" }) => {
    const [candlestickData, setCandlestickData] = useState<CandlestickData[]>([]);
    const [signals, setSignals] = useState<Signal[]>([]);
    const [error, setError] = useState<string | null>(null);

    const fetchCandlestickData = async () => {
        try {
            const endTime = Date.now();
            const startTime = endTime - (30 * 24 * 60 * 60 * 1000); // month ago
            const response = await axios.get(
                `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${startTime}&endTime=${endTime}`
            );
            const data: any = response.data;
            const formattedData: CandlestickData[] = data.map((item: any) => ({
                close: item[4],
                volume: item[5],
                closeTime: item[6],
            }));
            const signals = generateSignals(formattedData);
            setSignals(signals);
            setCandlestickData(formattedData);
        } catch (error) {
            setError("Failed to fetch data");
            console.error("The request has failed:", error);
        }
    };
    useEffect(() => {
        fetchCandlestickData();
    }, []);


    const formattedCandlestickData = useMemo(() => {
        return candlestickData.map((item, index) => {
            return {
                x: item.closeTime,
                y: parseFloat(item.close),
            }
        })
    }, [candlestickData]);


    const annotations = useMemo(() => {
        return signals.map((signal) => {
            const arrow = signal.type === "buy" ? "end" : "start"
            return {
                type: "line",
                xMin: signal.timestamp,
                xMax: signal.timestamp,
                yMin: parseFloat(signal.price),
                yMax: parseFloat(signal.price) + 1000, // to make arrow length
                borderColor: "black",
                arrowHeads: {
                    [arrow]: {
                        display: true,
                        borderColor: "black",
                    },
                }
            }
        })
    }, [signals]);

    const data = {
        datasets: [
            {
                label: "Price",
                data: formattedCandlestickData,
                fill: false,
                borderColor: "#6d996d",
                tension: 0.1,
                backgroundColor: formattedCandlestickData.map((point, index) => {
                    if (index > 0) {
                        const previousClose = formattedCandlestickData[index - 1].y;
                        const currentClose = point.y;
                        if (currentClose > previousClose) {
                            return "lightgreen"; // Green for bullish
                        } else {
                            return "#FF8488"; // Red for bearish
                        }
                    } else {
                        return "lightgreen";
                    }
                }),
            },

        ],
    };

    const options: any = {
        scales: {
            x: {
                type: "time",
            },
        },
        plugins: {
            title: {
                display: true,
                text: `${symbol} Price Movement`,
                padding: {
                    top: 10,
                    bottom: 10
                }
            },
            annotation: {
                annotations: annotations
            }
        }
    };
    return (
        <div style={{padding: 20}}>
            {error ? (
                <div>Error: {error}</div>
            ) : (
                <Line data={data} options={options}/>
            )}
        </div>
    );
};

export default CandlestickChart;
