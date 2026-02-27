/**
 * src/hooks/useOnboarding.ts
 *
 * Verifica en el arranque si la app tiene al menos una Empresa y una Serie
 * de facturación registradas.  Se usa en AppLayout para bloquear el acceso
 * al resto de la app y redirigir a /onboarding cuando la BD está vacía.
 *
 * El hook también hidrata el sessionStore con la primera empresa encontrada,
 * de forma que el resto de componentes tengan `empresa` disponible sin
 * necesidad de una pantalla de login (la autenticación es una fase posterior).
 */

import { useEffect, useState } from "react";
import { api, type OnboardingStatus } from "@/lib/api";
import { useSessionStore } from "@/stores/sessionStore";

export type OnboardingCheckState =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "required" };

/**
 * Retorna el estado actual de la comprobación de onboarding.
 *
 * - `loading`  → petición en curso; renderiza un spinner
 * - `ok`       → empresa + serie existen; renderiza la UI normal
 * - `required` → falta empresa o serie; AppLayout redirige a /onboarding
 */
export function useOnboarding(): OnboardingCheckState {
  const [state, setState] = useState<OnboardingCheckState>({ status: "loading" });
  const setEmpresa = useSessionStore((s) => s.setEmpresa);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const onboarding: OnboardingStatus = await api.verificarOnboarding();

        if (cancelled) return;

        if (!onboarding.tiene_empresa || !onboarding.tiene_serie) {
          setState({ status: "required" });
          return;
        }

        // Hidratar el store con la primera empresa disponible si aún no está
        if (onboarding.empresa_id !== null) {
          try {
            const empresas = await api.obtenerEmpresas();
            if (!cancelled) {
              const empresa = empresas.find((e) => e.id === onboarding.empresa_id);
              if (empresa) {
                setEmpresa({
                  id: empresa.id,
                  nombre: empresa.nombre,
                  nif: empresa.nif,
                  logo: undefined,
                });
              }
            }
          } catch {
            // No crítico: si falla la hidratación, el store ya tiene lo que
            // persisto en localStorage de sesiones anteriores
          }
        }

        if (!cancelled) setState({ status: "ok" });
      } catch {
        if (!cancelled) setState({ status: "required" });
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  // Solo se ejecuta una vez al montar el componente que guarda el guard
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
