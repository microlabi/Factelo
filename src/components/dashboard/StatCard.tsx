import React from "react";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  description?: string;
  trend?: { value: number; label: string };
  icon: React.ElementType;
  iconClassName?: string;
  className?: string;
  loading?: boolean;
}

export function StatCard({
  title,
  value,
  description,
  trend,
  icon: Icon,
  iconClassName,
  className,
  loading = false,
}: StatCardProps) {
  const trendPositive = trend && trend.value > 0;
  const trendNeutral = trend && trend.value === 0;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md",
        className
      )}
    >
      {/* Fondo decorativo */}
      <div
        className={cn(
          "absolute -right-4 -top-4 size-24 rounded-full opacity-5",
          iconClassName ?? "bg-primary"
        )}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>

          {loading ? (
            <div className="mt-2 h-8 w-32 animate-pulse rounded-md bg-muted" />
          ) : (
            <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">
              {value}
            </p>
          )}

          {description && !loading && (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          )}
        </div>

        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            iconClassName ?? "bg-primary/10"
          )}
        >
          <Icon
            className={cn(
              "size-5",
              iconClassName
                ? "text-white"
                : "text-primary"
            )}
          />
        </div>
      </div>

      {trend !== undefined && !loading && (
        <div className="mt-4 flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              trendNeutral
                ? "bg-muted text-muted-foreground"
                : trendPositive
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
            )}
          >
            {trendNeutral ? (
              <Minus className="size-3" />
            ) : trendPositive ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {Math.abs(trend.value).toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground">{trend.label}</span>
        </div>
      )}
    </div>
  );
}
