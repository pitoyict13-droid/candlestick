import React from "react";
import {render} from "@testing-library/react";
import App from "./App";
import {CandlestickChart} from "candlestick-app-chart";

jest.mock("candlestick-app-chart");
describe("App", () => {
    it("renders App component without crashin and CandlestickChart component", () => {
        render(<App/>);
        expect(CandlestickChart).toHaveBeenCalledTimes(1);
    });
});
