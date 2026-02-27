import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface DataPoint {
  mes: string;
  facturado: number;
  gastos: number;
}

const SAMPLE_DATA: DataPoint[] = [
  { mes: "Sep", facturado: 8_400, gastos: 3_100 },
  { mes: "Oct", facturado: 11_200, gastos: 4_200 },
  { mes: "Nov", facturado: 9_800, gastos: 3_900 },
  { mes: "Dic", facturado: 14_600, gastos: 5_100 },
  { mes: "Ene", facturado: 10_200, gastos: 3_800 },
  { mes: "Feb", facturado: 12_900, gastos: 4_600 },
];

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-lg text-sm">
      <p className="mb-2 font-semibold text-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-6">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="inline-block size-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            {entry.name}
          </span>
          <span className="font-medium text-foreground">
            {formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

interface RevenueChartProps {
  data?: DataPoint[];
}

export function RevenueChart({ data = SAMPLE_DATA }: RevenueChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="gradFacturado" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(221.2 83.2% 53.3%)" stopOpacity={0.15} />
            <stop offset="95%" stopColor="hsl(221.2 83.2% 53.3%)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradGastos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(0 84.2% 60.2%)" stopOpacity={0.12} />
            <stop offset="95%" stopColor="hsl(0 84.2% 60.2%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="hsl(214.3 31.8% 91.4%)"
        />
        <XAxis
          dataKey="mes"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "hsl(215.4 16.3% 46.9%)" }}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: "hsl(215.4 16.3% 46.9%)" }}
          tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: "hsl(214.3 31.8% 91.4%)" }} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
        />
        <Area
          type="monotone"
          dataKey="facturado"
          name="Facturado"
          stroke="hsl(221.2 83.2% 53.3%)"
          strokeWidth={2}
          fill="url(#gradFacturado)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="gastos"
          name="Gastos"
          stroke="hsl(0 84.2% 60.2%)"
          strokeWidth={2}
          fill="url(#gradGastos)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
