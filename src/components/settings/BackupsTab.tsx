import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  DatabaseBackup,
  FolderOpen,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  Clock,
  HardDrive,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface BackupStatus {
  backup_dir: string;
  last_backup: string | null;       // ISO datetime o null
  last_backup_size_bytes: number | null;
  total_backups: number;
}

interface ForceBackupResult {
  file_path: string;
  size_bytes: number;
  duration_ms: number;
}

// ─── Utilidades de formato ────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatRelative(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "hace menos de 1 minuto";
  if (minutes < 60) return `hace ${minutes} minuto${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} hora${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `hace ${days} día${days > 1 ? "s" : ""}`;
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export function BackupsTab() {
  const [isBacking, setIsBacking] = useState(false);
  const [lastResult, setLastResult] = useState<ForceBackupResult | null>(null);

  // ── Carga del estado actual de backups ──────────────────────────────────
  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = useQuery<BackupStatus>({
    queryKey: ["backup-status"],
    queryFn: () => invoke<BackupStatus>("get_backup_status"),
    staleTime: 1000 * 30, // refrescar cada 30s
  });

  // ── Forzar copia ────────────────────────────────────────────────────────
  async function handleForceBackup() {
    setIsBacking(true);
    setLastResult(null);
    const toastId = toast.loading("Realizando copia de seguridad…");

    try {
      const result = await invoke<ForceBackupResult>("force_backup");
      setLastResult(result);
      toast.success(
        `Copia completada en ${result.duration_ms} ms (${formatBytes(result.size_bytes)})`,
        { id: toastId, duration: 6000 }
      );
      refetch(); // actualizar el estado
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : "Error desconocido";
      toast.error(`Error al hacer la copia: ${message}`, { id: toastId, duration: 8000 });
    } finally {
      setIsBacking(false);
    }
  }

  // ── Abrir directorio de backups ─────────────────────────────────────────
  async function handleOpenDir() {
    try {
      await invoke("open_backup_dir");
    } catch {
      toast.error("No se pudo abrir el directorio de backups");
    }
  }

  // ── Render del estado de carga / error ──────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Cargando información de backups…
      </div>
    );
  }

  if (isError || !status) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          No se pudo obtener el estado de las copias de seguridad. Asegúrate de que la base de
          datos está accesible.
        </AlertDescription>
      </Alert>
    );
  }

  const isOld =
    status.last_backup
      ? Date.now() - new Date(status.last_backup).getTime() > 1000 * 60 * 60 * 24 * 3 // > 3 días
      : true;

  return (
    <div className="space-y-6">
      {/* ── Advertencia si el backup es antiguo ──────────────────────────── */}
      {isOld && (
        <Alert variant="warning">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Copia de seguridad desactualizada</AlertTitle>
          <AlertDescription>
            {status.last_backup
              ? `Tu última copia de seguridad se realizó ${formatRelative(status.last_backup)}.`
              : "Todavía no existe ninguna copia de seguridad."}{" "}
            Se recomienda hacer copias al menos cada 24 horas.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Panel de estado ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseBackup className="h-4 w-4 text-primary" />
            Estado de las copias de seguridad
          </CardTitle>
          <CardDescription>
            Factelo guarda copias incrementales de la base de datos SQLite en tu equipo local.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Directorio */}
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Directorio de backups
            </p>
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
              <code className="flex-1 break-all text-sm">{status.backup_dir}</code>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                title="Abrir en explorador de archivos"
                onClick={handleOpenDir}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold tabular-nums">{status.total_backups}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Copias realizadas</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-sm font-medium">
                {status.last_backup
                  ? new Date(status.last_backup).toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Última copia</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-sm font-medium">
                {status.last_backup_size_bytes != null
                  ? formatBytes(status.last_backup_size_bytes)
                  : "—"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">Tamaño último archivo</p>
            </div>
          </div>

          {/* Cuándo fue la última */}
          {status.last_backup && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>
                Última copia:{" "}
                <time
                  dateTime={status.last_backup}
                  title={new Date(status.last_backup).toLocaleString("es-ES")}
                >
                  {formatRelative(status.last_backup)}
                </time>
              </span>
              {!isOld && (
                <Badge variant="default" className="ml-auto gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Al día
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Resultado de la última copia forzada ─────────────────────────── */}
      {lastResult && (
        <Alert variant="success">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Copia de seguridad completada</AlertTitle>
          <AlertDescription className="space-y-1">
            <p className="break-all text-xs font-mono">{lastResult.file_path}</p>
            <p>
              Tamaño: <strong>{formatBytes(lastResult.size_bytes)}</strong> — Duración:{" "}
              <strong>{lastResult.duration_ms} ms</strong>
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      {/* ── Acción principal ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Forzar copia de seguridad ahora</p>
          <p className="text-xs text-muted-foreground">
            Crea una copia completa de la base de datos en el directorio configurado.
          </p>
        </div>
        <Button
          size="lg"
          className="shrink-0 gap-2"
          onClick={handleForceBackup}
          disabled={isBacking}
        >
          {isBacking ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Haciendo copia…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Forzar Copia de Seguridad Ahora
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
