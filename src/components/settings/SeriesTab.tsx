import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Loader2,
  ListChecks,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  serieSchema,
  SerieFormValues,
  defaultSerieValues,
} from "@/lib/schemas/settingsSchema";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Refleja exactamente el struct SerieRow del backend */
interface Serie {
  id: number;
  empresa_id: number;
  nombre: string;
  prefijo: string;
  siguiente_numero: number;
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
  children: React.ReactNode;
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

// ─── Modal de creación / edición ─────────────────────────────────────────────

interface SerieDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Serie | null;
  empresaId: number;
  onSaved: () => void;
}

function SerieDialog({ open, onOpenChange, initial, empresaId, onSaved }: SerieDialogProps) {
  const isEdit = Boolean(initial);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<SerieFormValues>({
    resolver: zodResolver(serieSchema),
    defaultValues: initial
      ? {
          nombre: initial.nombre,
          prefijo: initial.prefijo,
          siguiente_numero: initial.siguiente_numero,
        }
      : defaultSerieValues,
  });

  // Resetear valores al abrir
  React.useEffect(() => {
    if (open) {
      reset(
        initial
          ? {
              nombre: initial.nombre,
              prefijo: initial.prefijo,
              siguiente_numero: initial.siguiente_numero,
            }
          : defaultSerieValues
      );
    }
  }, [open, initial, reset]);

  async function onSubmit(data: SerieFormValues) {
    try {
      if (isEdit && initial) {
        await invoke("update_serie", {
          input: { id: initial.id, ...data },
        });
        toast.success(`Serie "${data.prefijo}" actualizada`);
      } else {
        await invoke("crear_serie", {
          input: { empresa_id: empresaId, nombre: data.nombre, prefijo: data.prefijo },
        });
        toast.success(`Serie "${data.prefijo}" creada`);
      }
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : "Error desconocido";
      toast.error(`Error: ${message}`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar serie" : "Nueva serie de facturación"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2">
          <FormField label="Nombre" id="nombre" error={errors.nombre?.message} required>
            <Input
              id="nombre"
              placeholder="Facturas generales 2026"
              {...register("nombre")}
              className={cn(errors.nombre && "border-destructive")}
            />
          </FormField>

          <FormField label="Prefijo" id="prefijo" error={errors.prefijo?.message} required>
            <Input
              id="prefijo"
              placeholder="2026, RECT, FAC-A, ..."
              {...register("prefijo")}
              className={cn(errors.prefijo && "border-destructive")}
            />
          </FormField>

          <FormField
            label="Siguiente número"
            id="siguiente_numero"
            error={errors.siguiente_numero?.message}
            required
          >
            <Input
              id="siguiente_numero"
              type="number"
              min={1}
              {...register("siguiente_numero")}
              className={cn(errors.siguiente_numero && "border-destructive")}
            />
          </FormField>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : isEdit ? (
                "Actualizar"
              ) : (
                "Crear serie"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal de confirmación de borrado ─────────────────────────────────────────

interface DeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serie: Serie | null;
  onDeleted: () => void;
}

function DeleteDialog({ open, onOpenChange, serie, onDeleted }: DeleteDialogProps) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!serie) return;
    setLoading(true);
    try {
      await invoke("delete_serie", { id: serie.id });
      toast.success(`Serie "${serie.prefijo}" eliminada`);
      onDeleted();
      onOpenChange(false);
    } catch (err: unknown) {
      const message =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : "Error al eliminar";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Eliminar serie
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          ¿Seguro que quieres eliminar la serie{" "}
          <strong className="text-foreground">{serie?.prefijo}</strong>? Esta acción no se puede
          deshacer y fallará si ya existen facturas asociadas.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function SeriesTab() {
  const empresa = useSessionStore(selectEmpresa);
  const empresaId = empresa?.id ?? 1;
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSerie, setEditingSerie] = useState<Serie | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingSerie, setDeletingSerie] = useState<Serie | null>(null);

  // ── Carga de series ─────────────────────────────────────────────────────
  const {
    data: series = [],
    isLoading,
    isError,
  } = useQuery<Serie[]>({
    queryKey: ["series", empresaId],
    queryFn: () => invoke<Serie[]>("obtener_series", { empresaId }),
    staleTime: 1000 * 60 * 5,
  });

  function openCreate() {
    setEditingSerie(null);
    setDialogOpen(true);
  }

  function openEdit(serie: Serie) {
    setEditingSerie(serie);
    setDialogOpen(true);
  }

  function openDelete(serie: Serie) {
    setDeletingSerie(serie);
    setDeleteOpen(true);
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["series", empresaId] });
  }

  // ── Estado vacío / carga / error ────────────────────────────────────────
  const renderBody = () => {
    if (isLoading) {
      return (
        <TableRow>
          <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
            Cargando series…
          </TableCell>
        </TableRow>
      );
    }
    if (isError) {
      return (
        <TableRow>
          <TableCell colSpan={5} className="py-8 text-center text-destructive">
            Error al cargar las series. Comprueba la conexión con la base de datos.
          </TableCell>
        </TableRow>
      );
    }
    if (series.length === 0) {
      return (
        <TableRow>
          <TableCell
            colSpan={5}
            className="py-12 text-center text-sm text-muted-foreground"
          >
            No hay series definidas. Crea una para empezar a emitir facturas.
          </TableCell>
        </TableRow>
      );
    }
    return series.map((s) => (
      <TableRow key={s.id}>
        <TableCell className="font-mono font-medium">{s.prefijo}</TableCell>
        <TableCell className="text-muted-foreground">
          {s.nombre || <span className="italic opacity-40">—</span>}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {s.siguiente_numero.toString().padStart(3, "0")}
        </TableCell>
        <TableCell>
          <Badge variant="default" className="gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Activa
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Editar"
              onClick={() => openEdit(s)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
              title="Eliminar"
              onClick={() => openDelete(s)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    ));
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-primary" />
              Series de facturación
            </CardTitle>
            <CardDescription className="mt-1.5">
              Gestiona los prefijos para numerar tus facturas (p.ej.{" "}
              <code className="text-xs">2026-001</code>,{" "}
              <code className="text-xs">RECT-001</code>).
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            Nueva serie
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prefijo</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-right">Siguiente nº</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>{renderBody()}</TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Modales */}
      <SerieDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editingSerie}
        empresaId={empresaId}
        onSaved={invalidate}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        serie={deletingSerie}
        onDeleted={invalidate}
      />
    </>
  );
}
