import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  Receipt,
  Settings,
  Building2,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import { IntegrityStatusBadge } from "@/components/ui/IntegrityGuard";

// ─── Definición de navegación ─────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

const navMain: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Facturas", href: "/facturas", icon: FileText },
  { label: "Clientes", href: "/clientes", icon: Users },
  { label: "Productos", href: "/productos", icon: Package },
  { label: "Gastos", href: "/gastos", icon: Receipt },
];

const navSecondary: NavItem[] = [
  { label: "Empresa", href: "/empresa", icon: Building2 },
  { label: "Configuración", href: "/configuracion", icon: Settings },
];

// ─── Componentes ─────────────────────────────────────────────────────────────

interface NavLinkProps {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
}

function NavLink({ item, collapsed, active }: NavLinkProps) {
  const Icon = item.icon;

  const linkContent = (
    <Link
      to={item.href}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        collapsed && "justify-center px-2.5"
      )}
    >
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors",
          active
            ? "text-sidebar-primary"
            : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80"
        )}
      />
      {!collapsed && (
        <span className="truncate leading-none">{item.label}</span>
      )}
      {!collapsed && item.badge && (
        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
          {item.badge}
        </span>
      )}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {item.label}
          {item.badge && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              ({item.badge})
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return linkContent;
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { pathname } = useLocation();
  const empresa = useSessionStore(selectEmpresa);

  return (
    <aside
      className={cn(
        "relative flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out",
        collapsed ? "w-[60px]" : "w-[220px]"
      )}
    >
      {/* ── Cabecera/Brand ─────────────────────────────────────────── */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-sidebar-border px-3",
          collapsed ? "justify-center" : "gap-2.5 px-4"
        )}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
          <TrendingUp className="size-4 text-primary-foreground" />
        </div>
        {!collapsed && (
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-bold tracking-tight text-sidebar-foreground">
              Factelo
            </span>
            <span className="truncate text-[11px] text-sidebar-foreground/50 max-w-[120px]">
              {empresa?.nombre ?? "Sin empresa"}
            </span>
          </div>
        )}
      </div>

      {/* ── Navegación principal ───────────────────────────────────── */}
      <ScrollArea className="flex-1 py-3">
        <nav className={cn("flex flex-col gap-0.5", collapsed ? "px-1.5" : "px-2")}>
          {navMain.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              active={
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href)
              }
            />
          ))}

          <Separator className="my-2 opacity-50" />

          {navSecondary.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              active={pathname.startsWith(item.href)}
            />
          ))}
        </nav>
      </ScrollArea>

      {/* ── Pie: estado de integridad del registro ────────────────── */}
      {!collapsed && (
        <div className="border-t border-sidebar-border p-3">
          <IntegrityStatusBadge />
        </div>
      )}

      {/* ── Botón colapsar ─────────────────────────────────────────── */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        className="absolute -right-3.5 top-[72px] z-10 size-7 rounded-full border border-sidebar-border bg-sidebar shadow-sm hover:bg-accent"
        aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronLeft className="size-3.5" />
        )}
      </Button>
    </aside>
  );
}
