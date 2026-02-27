import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  Building2,
  Upload,
  ShieldCheck,
  Loader2,
  ImageIcon,
  FileKey2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  empresaSchema,
  EmpresaFormValues,
  defaultEmpresaValues,
} from "@/lib/schemas/settingsSchema";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";

// ─── Props ────────────────────────────────────────────────────────────────────

interface EmpresaTabProps {
  initialData?: Partial<EmpresaFormValues>;
}

// ─── Campo de formulario con error ───────────────────────────────────────────

function FormField({
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
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Componente Principal ─────────────────────────────────────────────────────

export function EmpresaTab({ initialData }: EmpresaTabProps) {
  const empresa = useSessionStore(selectEmpresa);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EmpresaFormValues>({
    resolver: zodResolver(empresaSchema),
    defaultValues: {
      ...defaultEmpresaValues,
      nombre: empresa?.nombre ?? "",
      nif: empresa?.nif ?? "",
      ...initialData,
    },
  });

  const logoPath = watch("logo_path");
  const certPath = watch("cert_path");

  // ── Selector de logo ──────────────────────────────────────────────────────
  async function handleSelectLogo() {
    try {
      const selected = await open({
        title: "Seleccionar logotipo",
        filters: [
          { name: "Imágenes", extensions: ["png", "jpg", "jpeg", "svg", "webp"] },
        ],
        multiple: false,
      });
      if (typeof selected === "string") {
        setValue("logo_path", selected, { shouldDirty: true });
      }
    } catch {
      toast.error("No se pudo abrir el selector de archivos");
    }
  }

  // ── Selector de certificado ───────────────────────────────────────────────
  async function handleSelectCert() {
    try {
      const selected = await open({
        title: "Seleccionar certificado digital",
        filters: [
          {
            name: "Certificado digital (.p12 / .pfx)",
            extensions: ["p12", "pfx"],
          },
        ],
        multiple: false,
      });
      if (typeof selected === "string") {
        setValue("cert_path", selected, { shouldDirty: true });
        toast.info("Certificado seleccionado. Los datos se guardarán al pulsar 'Guardar cambios'.");
      }
    } catch {
      toast.error("No se pudo abrir el selector de archivos");
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function onSubmit(data: EmpresaFormValues) {
    try {
      await invoke("save_empresa_data", {
        input: {
          empresa_id: empresa?.id ?? 1,
          ...data,
        },
      });
      toast.success("Datos de empresa guardados correctamente");
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : "Error desconocido al guardar";
      toast.error(`Error al guardar: ${message}`);
    }
  }

  // ── Nombre corto del archivo ──────────────────────────────────────────────
  function basename(path: string) {
    return path.split(/[\\/]/).pop() ?? path;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* ── Datos fiscales ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" />
            Datos fiscales
          </CardTitle>
          <CardDescription>
            Información que aparecerá en tus facturas y documentos fiscales.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Razón social / Nombre"
            id="nombre"
            error={errors.nombre?.message}
            required
          >
            <Input
              id="nombre"
              placeholder="Mi Empresa S.L."
              {...register("nombre")}
              className={cn(errors.nombre && "border-destructive")}
            />
          </FormField>

          <FormField
            label="NIF / CIF"
            id="nif"
            error={errors.nif?.message}
            required
          >
            <Input
              id="nif"
              placeholder="B12345678"
              {...register("nif")}
              className={cn(errors.nif && "border-destructive")}
            />
          </FormField>

          <div className="sm:col-span-2">
            <FormField
              label="Dirección completa"
              id="direccion"
              error={errors.direccion?.message}
              required
            >
              <Input
                id="direccion"
                placeholder="Calle Mayor 1, 28001"
                {...register("direccion")}
                className={cn(errors.direccion && "border-destructive")}
              />
            </FormField>
          </div>

          <FormField label="Código postal" id="cp" error={errors.codigo_postal?.message}>
            <Input id="cp" placeholder="28001" maxLength={5} {...register("codigo_postal")} />
          </FormField>

          <FormField label="Población" id="poblacion" error={errors.poblacion?.message}>
            <Input id="poblacion" placeholder="Madrid" {...register("poblacion")} />
          </FormField>

          <FormField label="Provincia" id="provincia" error={errors.provincia?.message}>
            <Input id="provincia" placeholder="Madrid" {...register("provincia")} />
          </FormField>

          <FormField label="Teléfono" id="telefono" error={errors.telefono?.message}>
            <Input id="telefono" type="tel" placeholder="+34 600 000 000" {...register("telefono")} />
          </FormField>

          <div className="sm:col-span-2">
            <FormField label="Email de contacto" id="email" error={errors.email?.message}>
              <Input
                id="email"
                type="email"
                placeholder="contacto@miempresa.es"
                {...register("email")}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      {/* ── Logotipo ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ImageIcon className="h-4 w-4 text-primary" />
            Logotipo
          </CardTitle>
          <CardDescription>
            Imagen que se incluirá en el encabezado de tus facturas PDF.
            Formatos recomendados: PNG o SVG fondo transparente.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          {/* Preview */}
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border-2 border-dashed bg-muted">
            {logoPath ? (
              <img
                src={`asset://localhost/${encodeURIComponent(logoPath)}`}
                alt="Logo preview"
                className="h-full w-full rounded-lg object-contain p-1"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>

          <div className="space-y-1.5">
            <Button type="button" variant="outline" size="sm" onClick={handleSelectLogo}>
              <Upload className="mr-2 h-4 w-4" />
              {logoPath ? "Cambiar logotipo" : "Seleccionar logotipo"}
            </Button>
            {logoPath && (
              <p className="max-w-xs truncate text-xs text-muted-foreground">
                {basename(logoPath)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              La ruta se guarda localmente — no se sube a ningún servidor.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Certificado digital ──────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Certificado digital para FACe
          </CardTitle>
          <CardDescription>
            Certificado <strong>.p12</strong> o <strong>.pfx</strong> necesario para firmar
            facturas en formato Facturae y enviarlas a la Administración Pública a través de FACe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg border p-3",
              certPath
                ? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20"
                : "border-dashed"
            )}
          >
            <FileKey2
              className={cn(
                "h-8 w-8 shrink-0",
                certPath ? "text-green-600" : "text-muted-foreground"
              )}
            />
            <div className="min-w-0 flex-1">
              {certPath ? (
                <>
                  <p className="truncate text-sm font-medium">{basename(certPath)}</p>
                  <p className="truncate text-xs text-muted-foreground">{certPath}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ningún certificado seleccionado
                </p>
              )}
            </div>
            <Button
              type="button"
              variant={certPath ? "outline" : "default"}
              size="sm"
              onClick={handleSelectCert}
            >
              {certPath ? "Cambiar" : "Seleccionar"}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            ⚠️ El archivo de certificado permanece en tu equipo. Factelo solo guarda la ruta
            de acceso y nunca transmite el archivo.
          </p>
        </CardContent>
      </Card>

      <Separator />

      {/* ── Acción ───────────────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting || !isDirty} className="min-w-36">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando…
            </>
          ) : (
            "Guardar cambios"
          )}
        </Button>
      </div>
    </form>
  );
}
