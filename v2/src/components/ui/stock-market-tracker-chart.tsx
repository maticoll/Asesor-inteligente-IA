import React from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ArrowUpRight, ArrowDownRight, BarChart2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// Cuántos puntos de datos mostrar por período (días de trading)
const PERIOD_DAYS: Record<string, number> = {
  "1d": 2,
  "1w": 5,
  "1m": 21,
  "3m": 63,
  "1y": 252,
};

// Datos mock para el estado vacío (sin ticker real)
const generateMockData = (period: "1d" | "1w" | "1m" | "3m" | "1y") => {
  const basePrice = 440;
  const n = PERIOD_DAYS[period];
  return Array.from({ length: n }, (_, i) => ({
    time: i,
    price: parseFloat(
      (basePrice + (Math.random() - 0.5) * 10 + Math.sin(i * 0.1) * 5).toFixed(2),
    ),
    timestamp: new Date(Date.now() - (n - i) * 86400000).toISOString(),
  }));
};

const chartConfig: ChartConfig = {
  price: { label: "Price", color: "#3b82f6" },
};

export interface ComponentProps {
  ticker?: string
  closes?: number[]
  dates?: string[]
  currentPrice?: number
  className?: string
}

export const Component = ({
  ticker,
  closes = [],
  dates = [],
  currentPrice,
  className,
}: ComponentProps) => {
  const [selectedPeriod, setSelectedPeriod] = React.useState<
    "1d" | "1w" | "1m" | "3m" | "1y"
  >("3m");

  const hasRealData = closes.length > 0;

  const stockData = React.useMemo(() => {
    if (!hasRealData) return generateMockData(selectedPeriod);
    const n = Math.min(PERIOD_DAYS[selectedPeriod], closes.length);
    const slicedCloses = closes.slice(-n);
    const slicedDates = dates.slice(-n);
    return slicedCloses.map((price, i) => ({
      time: slicedDates[i]?.slice(0, 10) ?? i,
      price: parseFloat(price.toFixed(2)),
      timestamp: slicedDates[i] ?? String(i),
    }));
  }, [selectedPeriod, closes, dates, hasRealData]);

  const lastClose = closes.length > 0 ? closes[closes.length - 1] : 440;
  const displayPrice = currentPrice ?? lastClose;
  const firstPriceInPeriod = stockData[0]?.price ?? displayPrice;
  const pctChange =
    firstPriceInPeriod !== 0
      ? ((displayPrice - firstPriceInPeriod) / firstPriceInPeriod) * 100
      : 0;
  const isPositive = pctChange >= 0;

  const highestPrice = stockData.length > 0 ? Math.max(...stockData.map((d) => d.price)) : 0;
  const lowestPrice  = stockData.length > 0 ? Math.min(...stockData.map((d) => d.price)) : 0;

  const periods: { label: string; value: "1d" | "1w" | "1m" | "3m" | "1y" }[] = [
    { label: "1D", value: "1d" },
    { label: "1W", value: "1w" },
    { label: "1M", value: "1m" },
    { label: "3M", value: "3m" },
    { label: "1Y", value: "1y" },
  ];

  const displayName = ticker ? ticker.toUpperCase() : "DEMO";

  return (
    <Card
      className={cn(
        "flex w-full max-w-[480px] flex-col gap-6 p-5 shadow-none md:p-6",
        className,
      )}
    >
      <CardHeader className="flex flex-col items-start gap-4 p-0 md:flex-row md:items-center md:justify-between md:gap-0">
        <CardTitle className="flex items-center gap-2 text-base leading-none font-semibold">
          <BarChart2 className="size-5" aria-hidden="true" />
          <span>Stock Market Tracker</span>
        </CardTitle>
        <span className="rounded border border-border px-2 py-1 text-xs font-mono font-bold text-muted-foreground">
          {displayName}
        </span>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 p-0">
        {/* Selector de período */}
        <div className="group flex w-full -space-x-[1.5px] divide-x overflow-hidden rounded-lg border">
          {periods.map((period) => (
            <button
              key={period.value}
              onClick={() => setSelectedPeriod(period.value)}
              data-active={selectedPeriod === period.value}
              className="relative flex h-8 flex-1 items-center justify-center bg-transparent text-sm font-semibold tracking-[-0.006em] text-muted-foreground outline-none first:rounded-l-lg last:rounded-r-lg hover:bg-accent/50 data-[active=true]:bg-muted/60 data-[active=true]:text-foreground"
            >
              {period.label}
            </button>
          ))}
        </div>

        {/* Precio y variación */}
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-semibold tracking-[-0.006em] tabular-nums">
              ${displayPrice.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
            <span
              className={cn(
                "inline-flex h-6 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium tracking-[-0.006em] whitespace-nowrap",
                isPositive
                  ? "bg-[#E0FAEC] text-[#22C55E] dark:bg-emerald-900/50"
                  : "bg-red-100 text-red-500 dark:bg-red-900/50",
              )}
            >
              {isPositive ? (
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="size-3.5" aria-hidden="true" />
              )}
              {Math.abs(pctChange).toFixed(2)}%
            </span>
          </div>
          <p className="text-sm font-normal tracking-[-0.006em] text-muted-foreground uppercase">
            {displayName}
            {stockData.length > 0 && (
              <span className="ml-2 normal-case text-xs">
                ({stockData.length} sesiones)
              </span>
            )}
          </p>
        </div>

        {/* Gráfico */}
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[225px] w-full"
        >
          <LineChart accessibilityLayer data={stockData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="time" hide />
            <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
            <ChartTooltip
              content={<ChartTooltipContent hideIndicator hideLabel />}
              cursor={{ stroke: "#3b82f6", strokeWidth: 1 }}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 4,
                fill: "#3b82f6",
                stroke: "#ffffff",
                strokeWidth: 2,
              }}
            />
          </LineChart>
        </ChartContainer>

        {/* Máximo y mínimo del período */}
        <div className="group flex w-full -space-x-[1.5px] divide-x overflow-hidden rounded-lg border">
          <div className="flex h-8 flex-1 items-center justify-center text-sm tracking-[-0.006em]">
            <span className="font-normal text-muted-foreground">Highest</span>
            <span className="ml-1.5 font-semibold text-foreground">
              ${highestPrice.toFixed(2)}
            </span>
          </div>
          <div className="flex h-8 flex-1 items-center justify-center text-sm tracking-[-0.006em]">
            <span className="font-normal text-muted-foreground">Lowest</span>
            <span className="ml-1.5 font-semibold text-foreground">
              ${lowestPrice.toFixed(2)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
