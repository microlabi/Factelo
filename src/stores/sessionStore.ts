import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SessionUser {
  id: number;
  username: string;
}

export interface SessionEmpresa {
  id: number;
  nombre: string;
  nif: string;
  logo?: string;
}

interface SessionState {
  user: SessionUser | null;
  empresa: SessionEmpresa | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
}

interface SessionActions {
  login: (user: SessionUser, empresa: SessionEmpresa) => void;
  logout: () => void;
  setEmpresa: (empresa: SessionEmpresa) => void;
  setHydrated: () => void;
}

export type SessionStore = SessionState & SessionActions;

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      // Estado inicial
      user: null,
      empresa: null,
      isAuthenticated: false,
      isHydrated: false,

      // Acciones
      login: (user, empresa) =>
        set({ user, empresa, isAuthenticated: true }),

      logout: () =>
        set({ user: null, empresa: null, isAuthenticated: false }),

      setEmpresa: (empresa) =>
        set({ empresa }),

      setHydrated: () =>
        set({ isHydrated: true }),
    }),
    {
      name: "factelo-session",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        empresa: state.empresa,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
      },
    }
  )
);

// ─── Selectores ──────────────────────────────────────────────────────────────

export const selectUser = (s: SessionStore) => s.user;
export const selectEmpresa = (s: SessionStore) => s.empresa;
export const selectIsAuthenticated = (s: SessionStore) => s.isAuthenticated;
export const selectIsHydrated = (s: SessionStore) => s.isHydrated;
