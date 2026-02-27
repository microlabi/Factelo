/**
 * IntegrityGuard.tsx
 *
 * Componente que envuelve la App y bloquea la interfaz si se detecta que la
 * cadena de hashes SHA-256 del registro de facturación ha sido alterada.
 *
 * En cumplimiento del RD 1007/2023 (Veri*factu) y la Ley 8/2022 Crea y Crece:
 * ninguna factura puede modificarse ni eliminarse una vez emitida; si se
 * detecta una manipulación, la aplicación debe impedirse de operar.
 */

import { ReactNode } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Loader2,
  FileWarning,
} from "lucide-react";
import { useIntegrityCheck } from "@/hooks/useIntegrityCheck";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ─── Props ────────────────────────────────────────────────────────────────────

interface IntegrityGuardProps {
  children: ReactNode;
}

// ─── Pantalla de bloqueo ──────────────────────────────────────────────────────

function BlockedScreen({ errores }: { errores: string[] }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-destructive/5 p-6">
      <Card className="max-w-2xl w-full border-destructive/40 shadow-2xl">
        <CardHeader className="gap-3 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15">
              <ShieldAlert className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-destructive text-xl leading-tight">
                Integridad Comprometida
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Sistema de Registro Inalterable — Veri*factu / Ley Crea y Crece
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p className="font-semibold mb-2">
              ⚠ Se ha detectado una manipulación en la base de datos de
              facturas.
            </p>
            <p className="text-destructive/80">
              El encadenamiento de hashes SHA-256 del registro de facturación
              no es consistente. Esto puede indicar una alteración manual de los
              datos, lo que infringe el artículo 6 del RD 1007/2023
              (Veri*factu) y la Ley 8/2022 Crea y Crece.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Anomalías detectadas ({errores.length})
            </p>
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {errores.map((err, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-xs bg-muted/50 rounded px-3 py-2 font-mono text-destructive"
                >
                  <FileWarning className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {err}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300">
            <strong>Acción recomendada:</strong> Contacte con su asesor fiscal
            o con soporte técnico inmediatamente. No intente continuar usando la
            aplicación hasta resolver la anomalía. Puede que sea necesario
            restaurar una copia de seguridad íntegra.
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-2 pt-0">
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => window.location.reload()}
          >
            Volver a verificar
          </Button>
          <p className="text-[10px] text-center text-muted-foreground">
            Factelo · Registro de Facturación Inalterable · RD 1007/2023
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

// ─── Badge de estado de integridad (usado en el layout) ──────────────────────

export function IntegrityStatusBadge() {
  const state = useIntegrityCheck();

  if (state.status === "checking") {
    return (
      <Badge variant="secondary" className="gap-1.5 text-[10px]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Verificando…
      </Badge>
    );
  }
  if (state.status === "ok" || state.status === "no_empresa") {
    return (
      <Badge className="gap-1.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 border-0 text-[10px]">
        <ShieldCheck className="h-3 w-3" />
        Registro Seguro (No Veri*factu)
      </Badge>
    );
  }
  if (state.status === "compromised") {
    return (
      <Badge variant="destructive" className="gap-1.5 text-[10px]">
        <ShieldAlert className="h-3 w-3" />
        Integridad Comprometida
      </Badge>
    );
  }
  return null;
}

// ─── Guard principal ──────────────────────────────────────────────────────────

export function IntegrityGuard({ children }: IntegrityGuardProps) {
  const state = useIntegrityCheck();

  // Mientras verifica o no hay empresa, deja pasar (no bloquea)
  if (state.status === "checking" || state.status === "no_empresa" || state.status === "error") {
    return <>{children}</>;
  }

  // Si la cadena está comprometida, bloquear completamente la UI
  if (state.status === "compromised") {
    return <BlockedScreen errores={state.errores} />;
  }

  return <>{children}</>;
}
