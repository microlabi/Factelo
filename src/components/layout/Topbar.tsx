import React from "react";
import { Bell, Search, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSessionStore, selectUser, selectEmpresa } from "@/stores/sessionStore";
import { cn } from "@/lib/utils";

interface TopbarProps {
  title: string;
  description?: string;
  darkMode: boolean;
  onToggleDark: () => void;
}

export function Topbar({ title, description, darkMode, onToggleDark }: TopbarProps) {
  const user = useSessionStore(selectUser);
  const empresa = useSessionStore(selectEmpresa);

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 border-b bg-background/80 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Título de sección */}
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-semibold leading-none text-foreground truncate">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground truncate">{description}</p>
        )}
      </div>

      {/* Buscador global */}
      <div className="hidden md:flex relative w-56">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Buscar…"
          className="pl-8 h-8 text-sm bg-muted/50 border-0 focus-visible:ring-1"
        />
      </div>

      <div className="flex items-center gap-1">
        {/* Modo oscuro */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={onToggleDark}
            >
              {darkMode ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{darkMode ? "Modo claro" : "Modo oscuro"}</TooltipContent>
        </Tooltip>

        {/* Notificaciones */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 relative">
              <Bell className="size-4" />
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notificaciones</TooltipContent>
        </Tooltip>

        {/* Avatar de usuario */}
        <div className={cn(
          "ml-1 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold uppercase",
          "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
        )}>
          {user?.username?.charAt(0) ?? empresa?.nombre?.charAt(0) ?? "F"}
        </div>
      </div>
    </header>
  );
}
