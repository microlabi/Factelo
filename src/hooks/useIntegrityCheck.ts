/**
 * useIntegrityCheck.ts
 *
 * Comprueba la integridad de la cadena de hashes SHA-256 del log de eventos
 * en cada arranque de la aplicación.  Si la cadena está comprometida, devuelve
 * los detalles para que <IntegrityGuard> bloquee la UI.
 */

import { useState, useEffect } from "react";
import { api, isApiError, ResultadoIntegridad } from "@/lib/api";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";

export type IntegrityState =
  | { status: "checking" }
  | { status: "ok"; totalEventos: number; ultimoEvento: string | null }
  | { status: "compromised"; errores: string[]; totalEventos: number }
  | { status: "no_empresa" }
  | { status: "error"; message: string };

export function useIntegrityCheck(): IntegrityState {
  const empresa = useSessionStore(selectEmpresa);
  const [state, setState] = useState<IntegrityState>({ status: "checking" });

  useEffect(() => {
    if (!empresa) {
      setState({ status: "no_empresa" });
      return;
    }

    let cancelled = false;

    async function check() {
      setState({ status: "checking" });
      try {
        const resultado: ResultadoIntegridad = await api.verificarIntegridadBd(
          empresa!.id
        );
        if (cancelled) return;

        if (resultado.integra) {
          setState({
            status: "ok",
            totalEventos: resultado.total_eventos,
            ultimoEvento: resultado.ultimo_evento,
          });
        } else {
          setState({
            status: "compromised",
            errores: resultado.errores,
            totalEventos: resultado.total_eventos,
          });
        }
      } catch (err) {
        if (cancelled) return;
        const msg = isApiError(err) ? err.message : String(err);
        setState({ status: "error", message: msg });
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [empresa?.id]);

  return state;
}
