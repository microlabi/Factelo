/**
 * src/pages/OnboardingPage.tsx
 *
 * Primera experiencia de usuario: registro del perfil fiscal (Empresa)
 * y la primera Serie de facturación.  Hasta que el usuario complete
 * ambos pasos, el resto de la app permanece bloqueado.
 *
 * Flujo: Paso 1 (datos empresa) → Paso 2 (datos serie) → Dashboard
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  FileText,
  Hash,
  AlertCircle,
} from "lucide-react";

import { api } from "@/lib/api";
import { useSessionStore } from "@/stores/sessionStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Tipos de formulario ─────────────────────────────────────────────────────

interface EmpresaFormData {
  nombre: string;
  nif: string;
  direccion: string;
}

interface SerieFormData {
  nombre: string;
  prefijo: string;
}

const EMPRESA_EMPTY: EmpresaFormData = { nombre: "", nif: "", direccion: "" };
const SERIE_EMPTY: SerieFormData = { nombre: "General", prefijo: "FAC" };

// ─── Componente de campo con error ───────────────────────────────────────────

function Field({
  label,
  id,
  error,
  required,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Indicador de paso ────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center justify-center gap-3">
      {[1, 2].map((n) => (
        <React.Fragment key={n}>
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-full text-sm font-semibold transition-colors",
              step === n
                ? "bg-primary text-primary-foreground"
                : step > n
                  ? "bg-emerald-500 text-white"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {step > n ? <CheckCircle2 className="size-4" /> : n}
          </div>
          {n < 2 && (
            <div
              className={cn(
                "h-px w-12 transition-colors",
                step > 1 ? "bg-emerald-500" : "bg-muted"
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── OnboardingPage ───────────────────────────────────────────────────────────

export function OnboardingPage() {
  const navigate = useNavigate();
  const setEmpresa = useSessionStore((s) => s.setEmpresa);

  const [step, setStep] = useState<1 | 2>(1);
  const [empresaData, setEmpresaData] = useState<EmpresaFormData>(EMPRESA_EMPTY);
  const [serieData, setSerieData] = useState<SerieFormData>(SERIE_EMPTY);
  const [empresaErrors, setEmpresaErrors] = useState<Partial<EmpresaFormData>>({});
  const [serieErrors, setSerieErrors] = useState<Partial<SerieFormData>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // ── Validación paso 1 ─────────────────────────────────────────────────────

  function validateEmpresa(): boolean {
    const errs: Partial<EmpresaFormData> = {};
    if (!empresaData.nombre.trim()) errs.nombre = "El nombre es obligatorio";
    if (!empresaData.nif.trim()) errs.nif = "El NIF/CIF es obligatorio";
    else if (!/^[A-Z0-9]{7,9}$/i.test(empresaData.nif.trim()))
      errs.nif = "Formato de NIF/CIF no válido";
    if (!empresaData.direccion.trim())
      errs.direccion = "La dirección es obligatoria";
    setEmpresaErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Validación paso 2 ─────────────────────────────────────────────────────

  function validateSerie(): boolean {
    const errs: Partial<SerieFormData> = {};
    if (!serieData.nombre.trim()) errs.nombre = "El nombre es obligatorio";
    if (!serieData.prefijo.trim()) errs.prefijo = "El prefijo es obligatorio";
    else if (!/^[A-Z0-9-]{1,10}$/i.test(serieData.prefijo.trim()))
      errs.prefijo = "Solo letras, números y guiones (máx. 10 caracteres)";
    setSerieErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Avanzar al paso 2 ─────────────────────────────────────────────────────

  function handleNextStep() {
    if (validateEmpresa()) setStep(2);
  }

  // ── Envío final ───────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validateSerie()) return;

    setApiError(null);
    setIsLoading(true);

    try {
      // 1. Crear empresa
      const empresa = await api.crearEmpresa({
        nombre: empresaData.nombre.trim(),
        nif: empresaData.nif.trim().toUpperCase(),
        direccion: empresaData.direccion.trim(),
      });

      // 2. Crear serie vinculada a la empresa
      await api.crearSerie({
        empresa_id: empresa.id,
        nombre: serieData.nombre.trim(),
        prefijo: serieData.prefijo.trim().toUpperCase(),
      });

      // 3. Hidratar el store de sesión
      setEmpresa({
        id: empresa.id,
        nombre: empresa.nombre,
        nif: empresa.nif,
        logo: undefined,
      });

      // 4. Ir al dashboard
      navigate("/", { replace: true });
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "Error desconocido. Inténtalo de nuevo.";
      setApiError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted/40 p-4">
      <div className="w-full max-w-md">
        {/* Logo / Título */}
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 shadow-sm">
            <Building2 className="size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Bienvenido a Factelo
          </h1>
          <p className="text-sm text-muted-foreground">
            Configura tu perfil fiscal antes de empezar a facturar
          </p>
        </div>

        <StepIndicator step={step} />

        <form onSubmit={handleSubmit} className="mt-6">
          {/* ── Paso 1: Empresa ─────────────────────────────────────────── */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Building2 className="size-4 text-primary" />
                  <div>
                    <CardTitle className="text-base">Datos de tu empresa</CardTitle>
                    <CardDescription className="text-xs">
                      Información que aparecerá en tus facturas
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <Field
                  label="Nombre / Razón social"
                  id="nombre"
                  error={empresaErrors.nombre}
                  required
                >
                  <Input
                    id="nombre"
                    placeholder="Acme Soluciones SL"
                    value={empresaData.nombre}
                    onChange={(e) =>
                      setEmpresaData((p) => ({ ...p, nombre: e.target.value }))
                    }
                    autoFocus
                  />
                </Field>

                <Field
                  label="NIF / CIF"
                  id="nif"
                  error={empresaErrors.nif}
                  required
                >
                  <Input
                    id="nif"
                    placeholder="B12345678"
                    value={empresaData.nif}
                    onChange={(e) =>
                      setEmpresaData((p) => ({
                        ...p,
                        nif: e.target.value.toUpperCase(),
                      }))
                    }
                    maxLength={9}
                  />
                </Field>

                <Field
                  label="Dirección fiscal"
                  id="direccion"
                  error={empresaErrors.direccion}
                  required
                >
                  <Input
                    id="direccion"
                    placeholder="Calle Mayor 1, 28001 Madrid"
                    value={empresaData.direccion}
                    onChange={(e) =>
                      setEmpresaData((p) => ({ ...p, direccion: e.target.value }))
                    }
                  />
                </Field>
              </CardContent>

              <CardFooter>
                <Button
                  type="button"
                  className="ml-auto gap-2"
                  onClick={handleNextStep}
                >
                  Siguiente
                  <ArrowRight className="size-4" />
                </Button>
              </CardFooter>
            </Card>
          )}

          {/* ── Paso 2: Serie ────────────────────────────────────────────── */}
          {step === 2 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-primary" />
                  <div>
                    <CardTitle className="text-base">
                      Serie de facturación
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Define cómo se numerarán tus facturas (ej. FAC-0001)
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <Field
                  label="Nombre de la serie"
                  id="serie-nombre"
                  error={serieErrors.nombre}
                  required
                >
                  <Input
                    id="serie-nombre"
                    placeholder="General"
                    value={serieData.nombre}
                    onChange={(e) =>
                      setSerieData((p) => ({ ...p, nombre: e.target.value }))
                    }
                    autoFocus
                  />
                </Field>

                <Field
                  label="Prefijo"
                  id="serie-prefijo"
                  error={serieErrors.prefijo}
                  required
                >
                  <div className="flex items-center gap-2">
                    <Hash className="size-4 shrink-0 text-muted-foreground" />
                    <Input
                      id="serie-prefijo"
                      placeholder="FAC"
                      value={serieData.prefijo}
                      onChange={(e) =>
                        setSerieData((p) => ({
                          ...p,
                          prefijo: e.target.value.toUpperCase(),
                        }))
                      }
                      maxLength={10}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Tus facturas se numerarán como{" "}
                    <strong>
                      {serieData.prefijo.trim() || "FAC"}-0001
                    </strong>
                    ,{" "}
                    <strong>
                      {serieData.prefijo.trim() || "FAC"}-0002
                    </strong>
                    …
                  </p>
                </Field>

                {/* Error de API */}
                {apiError && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <p className="text-destructive">{apiError}</p>
                  </div>
                )}
              </CardContent>

              <CardFooter className="flex justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2"
                  onClick={() => setStep(1)}
                  disabled={isLoading}
                >
                  <ArrowLeft className="size-4" />
                  Atrás
                </Button>

                <Button type="submit" className="gap-2" disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Creando…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-4" />
                      Comenzar a facturar
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          )}
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Podrás cambiar estos datos en cualquier momento desde{" "}
          <strong>Mi empresa</strong>.
        </p>
      </div>
    </div>
  );
}
