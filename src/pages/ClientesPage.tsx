import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Users,
  Plus,
  Loader2,
  Pencil,
  Trash2,
  Building2,
  MapPin,
  FileText,
  Euro,
  Landmark,
} from "lucide-react";

import { api } from "@/lib/api";
import type { ClienteRow, ActualizarClienteInput, CrearClienteInput } from "@/lib/api";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import {
  clienteSchema,
  clienteEditSchema,
  TIPOS_ENTIDAD,
  METODOS_PAGO,
  PAISES_ISO,
  type ClienteFormValues,
  type ClienteEditValues,
} from "@/lib/schemas/clienteSchema";

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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tipoEntidadBadge(tipo: string) {
  if (tipo === "Entidad_Publica")
    return <Badge variant="outline" className="text-blue-600 border-blue-300">B2G – Ent. Pública</Badge>;
  if (tipo === "Autónomo")
    return <Badge variant="outline" className="text-amber-600 border-amber-300">B2C – Autónomo</Badge>;
  return <Badge variant="outline" className="text-emerald-600 border-emerald-300">B2B – Empresa</Badge>;
}

const METODO_PAGO_SIN_PREFERENCIA = "__sin_preferencia__";

const CLIENTES_PRUEBA: Omit<CrearClienteInput, "empresa_id">[] = [
  {
    tipo_entidad: "Entidad_Publica",
    nombre: "Ayuntamiento de Las Rozas",
    nif: "P2812700I",
    nombre_comercial: "Área de Contratación",
    email: "contratacion@lasrozas.es",
    telefono: "+34 916 402 900",
    persona_contacto: "Marta López",
    direccion: "Plaza Mayor, 1",
    codigo_postal: "28231",
    poblacion: "Las Rozas",
    provincia: "Madrid",
    pais: "ES",
    metodo_pago_defecto: "transferencia",
    dias_vencimiento: 30,
    dir3_oficina_contable: "L01281270",
    dir3_organo_gestor: "L01281270",
    dir3_unidad_tramitadora: "L01281270",
  },
  {
    tipo_entidad: "Entidad_Publica",
    nombre: "Universidad Pública de Levante",
    nif: "Q4602001H",
    nombre_comercial: "Servicio de Compras",
    email: "compras@upl.es",
    telefono: "+34 963 111 222",
    persona_contacto: "Alberto Navarro",
    direccion: "Av. del Campus, 12",
    codigo_postal: "46022",
    poblacion: "Valencia",
    provincia: "Valencia",
    pais: "ES",
    metodo_pago_defecto: "transferencia",
    dias_vencimiento: 30,
    dir3_oficina_contable: "U04600001",
    dir3_organo_gestor: "U04600002",
    dir3_unidad_tramitadora: "U04600003",
  },
  {
    tipo_entidad: "Entidad_Publica",
    nombre: "Consorcio de Aguas del Sur",
    nif: "Q1100456C",
    nombre_comercial: "Departamento Técnico",
    email: "licitaciones@aguassur.es",
    telefono: "+34 956 410 010",
    persona_contacto: "Rocío Serrano",
    direccion: "Calle del Puerto, 45",
    codigo_postal: "11006",
    poblacion: "Cádiz",
    provincia: "Cádiz",
    pais: "ES",
    metodo_pago_defecto: "domiciliacion",
    dias_vencimiento: 45,
    dir3_oficina_contable: "A11000011",
    dir3_organo_gestor: "A11000012",
    dir3_unidad_tramitadora: "A11000013",
  },
  {
    tipo_entidad: "Empresa",
    nombre: "Tecnored Sistemas S.L.",
    nif: "B76543210",
    nombre_comercial: "Tecnored",
    email: "administracion@tecnored.es",
    telefono: "+34 934 555 100",
    persona_contacto: "Clara Mena",
    direccion: "Carrer de Balmes, 101",
    codigo_postal: "08008",
    poblacion: "Barcelona",
    provincia: "Barcelona",
    pais: "ES",
    metodo_pago_defecto: "transferencia",
    dias_vencimiento: 30,
  },
  {
    tipo_entidad: "Empresa",
    nombre: "Logística Faro Norte S.A.",
    nif: "A15432109",
    nombre_comercial: "Faro Norte",
    email: "facturas@faronorte.es",
    telefono: "+34 981 210 300",
    persona_contacto: "Iván Varela",
    direccion: "Polígono Río do Pozo, Parcela 8",
    codigo_postal: "15578",
    poblacion: "Narón",
    provincia: "A Coruña",
    pais: "ES",
    metodo_pago_defecto: "domiciliacion",
    dias_vencimiento: 60,
  },
  {
    tipo_entidad: "Empresa",
    nombre: "Clínica Horizonte Dental S.L.P.",
    nif: "B44887766",
    nombre_comercial: "Horizonte Dental",
    email: "contabilidad@horizontedental.es",
    telefono: "+34 952 778 440",
    persona_contacto: "Noelia Martín",
    direccion: "Av. de Andalucía, 88",
    codigo_postal: "29007",
    poblacion: "Málaga",
    provincia: "Málaga",
    pais: "ES",
    metodo_pago_defecto: "tarjeta",
    dias_vencimiento: 15,
  },
  {
    tipo_entidad: "Autónomo",
    nombre: "Javier Ruiz Montoya",
    nif: "53124578K",
    nombre_comercial: "JRM Reformas",
    email: "javier@jrmreformas.es",
    telefono: "+34 605 112 334",
    persona_contacto: "Javier Ruiz",
    direccion: "Calle Castaños, 9",
    codigo_postal: "41003",
    poblacion: "Sevilla",
    provincia: "Sevilla",
    pais: "ES",
    metodo_pago_defecto: "efectivo",
    dias_vencimiento: 7,
  },
  {
    tipo_entidad: "Autónomo",
    nombre: "Laura Pineda Ortega",
    nif: "27456891M",
    nombre_comercial: "LP Diseño",
    email: "laura@lpdiseno.es",
    telefono: "+34 644 700 901",
    persona_contacto: "Laura Pineda",
    direccion: "Calle Real, 22",
    codigo_postal: "18009",
    poblacion: "Granada",
    provincia: "Granada",
    pais: "ES",
    metodo_pago_defecto: "transferencia",
    dias_vencimiento: 15,
  },
  {
    tipo_entidad: "Autónomo",
    nombre: "Miguel Ángel Prieto Díaz",
    nif: "11890234T",
    nombre_comercial: "MP Audio",
    email: "miguel@mpaudio.es",
    telefono: "+34 689 001 776",
    persona_contacto: "Miguel Prieto",
    direccion: "Rúa Rosalía de Castro, 31",
    codigo_postal: "36201",
    poblacion: "Vigo",
    provincia: "Pontevedra",
    pais: "ES",
    metodo_pago_defecto: "cheque",
    dias_vencimiento: 10,
  },
];

// ─── Subcomponente: sección del formulario ────────────────────────────────────

function FormSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <Separator />
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

// ─── Campo de texto reutilizable ──────────────────────────────────────────────

function Field({
  label,
  required,
  children,
  error,
  colSpan = 1,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  error?: string;
  colSpan?: 1 | 2;
}) {
  return (
    <div className={colSpan === 2 ? "sm:col-span-2" : undefined}>
      <Label className="mb-1 block text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// ─── Formulario de cliente ────────────────────────────────────────────────────

interface ClienteDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  empresaId: number;
  editing?: ClienteRow;
}

function ClienteDialog({ open, onOpenChange, empresaId, editing }: ClienteDialogProps) {
  const queryClient = useQueryClient();

  const defaultValues: ClienteFormValues = {
    empresa_id: empresaId,
    tipo_entidad: editing?.tipo_entidad ?? "Empresa",
    nombre: editing?.nombre ?? "",
    nif: editing?.nif ?? undefined,
    nombre_comercial: editing?.nombre_comercial ?? undefined,
    direccion: editing?.direccion ?? undefined,
    codigo_postal: editing?.codigo_postal ?? undefined,
    poblacion: editing?.poblacion ?? undefined,
    provincia: editing?.provincia ?? undefined,
    pais: editing?.pais ?? "ES",
    email: editing?.email ?? undefined,
    telefono: editing?.telefono ?? undefined,
    persona_contacto: editing?.persona_contacto ?? undefined,
    metodo_pago_defecto: editing?.metodo_pago_defecto ?? undefined,
    dias_vencimiento: editing?.dias_vencimiento ?? 30,
    iban_cuenta: editing?.iban_cuenta ?? undefined,
    aplica_irpf: Boolean(editing?.aplica_irpf),
    aplica_recargo_eq: Boolean(editing?.aplica_recargo_eq),
    operacion_intracomunitaria: Boolean(editing?.operacion_intracomunitaria),
    dir3_oficina_contable: editing?.dir3_oficina_contable ?? undefined,
    dir3_organo_gestor: editing?.dir3_organo_gestor ?? undefined,
    dir3_unidad_tramitadora: editing?.dir3_unidad_tramitadora ?? undefined,
  };

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClienteFormValues>({
    resolver: zodResolver(editing ? clienteEditSchema : clienteSchema),
    defaultValues,
  });

  const tipoEntidad = watch("tipo_entidad");
  const esEntidadPublica = tipoEntidad === "Entidad_Publica";

  const createMutation = useMutation({
    mutationFn: api.crearCliente,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientes", empresaId] });
      toast.success("Cliente creado correctamente");
      reset();
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : "No se pudo crear el cliente";
      toast.error(msg);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ActualizarClienteInput) => api.actualizarCliente(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientes", empresaId] });
      toast.success("Cliente actualizado correctamente");
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : "No se pudo actualizar el cliente";
      toast.error(msg);
    },
  });

  const onSubmit = (data: ClienteFormValues) => {
    if (editing) {
      updateMutation.mutate({ ...data, id: editing.id } as ClienteEditValues & { id: number });
    } else {
      createMutation.mutate(data);
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending || isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-4" />
            {editing ? "Editar cliente" : "Nuevo cliente"}
          </DialogTitle>
          <DialogDescription>
            Rellena los datos del contacto. Los campos marcados con{" "}
            <span className="text-destructive font-medium">*</span> son obligatorios.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh] pr-2">
          <form id="cliente-form" onSubmit={handleSubmit(onSubmit)} className="space-y-6 p-1">
            {/* ── 1. Identificación ──────────────────────────────────────── */}
            <FormSection icon={<Building2 className="size-4" />} title="Identificación">
              <Field label="Tipo de entidad" required error={errors.tipo_entidad?.message}>
                <Controller
                  control={control}
                  name="tipo_entidad"
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona tipo…" />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_ENTIDAD.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="NIF / CIF / NIE / VAT" error={errors.nif?.message}>
                <Input {...register("nif")} placeholder="B12345678 · ES-B12345678" />
              </Field>

              <Field label="Razón social" required colSpan={2} error={errors.nombre?.message}>
                <Input {...register("nombre")} placeholder="Acme S.L." />
              </Field>

              <Field label="Nombre comercial" colSpan={2} error={errors.nombre_comercial?.message}>
                <Input {...register("nombre_comercial")} placeholder="Acme (opcional)" />
              </Field>
            </FormSection>

            {/* ── 2. Dirección y contacto ───────────────────────────────── */}
            <FormSection icon={<MapPin className="size-4" />} title="Dirección y Contacto">
              <Field label="Dirección" colSpan={2} error={errors.direccion?.message}>
                <Input {...register("direccion")} placeholder="Calle Mayor 1, 2.º A" />
              </Field>

              <Field label="Código postal" error={errors.codigo_postal?.message}>
                <Input {...register("codigo_postal")} placeholder="28001" />
              </Field>

              <Field label="Ciudad / Municipio" error={errors.poblacion?.message}>
                <Input {...register("poblacion")} placeholder="Madrid" />
              </Field>

              <Field label="Provincia" error={errors.provincia?.message}>
                <Input {...register("provincia")} placeholder="Madrid" />
              </Field>

              <Field label="País" required error={errors.pais?.message}>
                <Controller
                  control={control}
                  name="pais"
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAISES_ISO.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Email de facturación" error={errors.email?.message}>
                <Input {...register("email")} type="email" placeholder="facturacion@empresa.es" />
              </Field>

              <Field label="Teléfono" error={errors.telefono?.message}>
                <Input {...register("telefono")} placeholder="+34 91 000 00 00" />
              </Field>

              <Field label="Persona de contacto" colSpan={2} error={errors.persona_contacto?.message}>
                <Input {...register("persona_contacto")} placeholder="Juan García" />
              </Field>
            </FormSection>

            {/* ── 3. Preferencias de facturación ───────────────────────── */}
            <FormSection icon={<FileText className="size-4" />} title="Preferencias de Facturación">
              <Field label="Método de pago por defecto" error={errors.metodo_pago_defecto?.message}>
                <Controller
                  control={control}
                  name="metodo_pago_defecto"
                  render={({ field }) => (
                    <Select
                      onValueChange={(value) =>
                        field.onChange(
                          value === METODO_PAGO_SIN_PREFERENCIA ? undefined : value
                        )
                      }
                      value={field.value ?? METODO_PAGO_SIN_PREFERENCIA}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Sin preferencia" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={METODO_PAGO_SIN_PREFERENCIA}>Sin preferencia</SelectItem>
                        {METODOS_PAGO.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>

              <Field label="Días de vencimiento" error={errors.dias_vencimiento?.message}>
                <Input {...register("dias_vencimiento")} type="number" min={0} max={365} />
              </Field>

              <Field label="IBAN / Cuenta bancaria" colSpan={2} error={errors.iban_cuenta?.message}>
                <Input
                  {...register("iban_cuenta")}
                  placeholder="ES91 2100 0418 4502 0005 1332"
                  className="font-mono"
                />
              </Field>
            </FormSection>

            {/* ── 4. Fiscalidad ─────────────────────────────────────────── */}
            <FormSection icon={<Euro className="size-4" />} title="Fiscalidad">
              <div className="sm:col-span-2 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["aplica_irpf", "Aplica IRPF"],
                    ["aplica_recargo_eq", "Aplica recargo de equivalencia"],
                    ["operacion_intracomunitaria", "Operación intracomunitaria"],
                  ] as const
                ).map(([name, label]) => (
                  <label
                    key={name}
                    className="flex items-center gap-2 rounded-md border p-3 cursor-pointer select-none hover:bg-muted/40 transition-colors"
                  >
                    <input
                      type="checkbox"
                      {...register(name)}
                      className="size-4 accent-primary"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </FormSection>

            {/* ── 5. Códigos DIR3 (solo Entidades Públicas) ─────────────── */}
            {esEntidadPublica && (
              <FormSection
                icon={<Landmark className="size-4" />}
                title="Códigos DIR3 — Solo Entidades Públicas"
              >
                <div className="sm:col-span-2">
                  <p className="text-xs text-muted-foreground mb-3">
                    Obligatorios para la factura electrónica Face / Facturae 3.2.x. Puedes
                    consultarlos en el directorio oficial{" "}
                    <a
                      href="https://face.gob.es/es/directorio"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-primary"
                    >
                      face.gob.es
                    </a>
                    .
                  </p>
                </div>

                <Field
                  label="Oficina contable (DIR3)"
                  required
                  error={errors.dir3_oficina_contable?.message}
                >
                  <Input
                    {...register("dir3_oficina_contable")}
                    placeholder="P00000000"
                    className="font-mono uppercase"
                  />
                </Field>

                <Field
                  label="Órgano gestor (DIR3)"
                  required
                  error={errors.dir3_organo_gestor?.message}
                >
                  <Input
                    {...register("dir3_organo_gestor")}
                    placeholder="P00000001"
                    className="font-mono uppercase"
                  />
                </Field>

                <Field
                  label="Unidad tramitadora (DIR3)"
                  required
                  error={errors.dir3_unidad_tramitadora?.message}
                >
                  <Input
                    {...register("dir3_unidad_tramitadora")}
                    placeholder="P00000002"
                    className="font-mono uppercase"
                  />
                </Field>
              </FormSection>
            )}
          </form>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="submit" form="cliente-form" disabled={pending} className="gap-2 min-w-24">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export function ClientesPage() {
  const empresa = useSessionStore(selectEmpresa);
  const empresaId = empresa?.id;
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClienteRow | undefined>(undefined);
  const [search, setSearch] = useState("");

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["clientes", empresaId],
    queryFn: () => api.obtenerClientes(empresaId as number),
    enabled: !!empresaId,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, empresaId }: { id: number; empresaId: number }) =>
      api.eliminarCliente(id, empresaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientes", empresaId] });
      toast.success("Cliente eliminado");
    },
    onError: () => toast.error("No se pudo eliminar el cliente"),
  });

  const seedTemplatesMutation = useMutation({
    mutationFn: async () => {
      if (!empresaId) throw new Error("Selecciona una empresa primero");
      const results = await Promise.allSettled(
        CLIENTES_PRUEBA.map((cliente) =>
          api.crearCliente({
            ...cliente,
            empresa_id: empresaId,
          })
        )
      );
      const creados = results.filter((r) => r.status === "fulfilled").length;
      const fallidos = results.length - creados;
      return { creados, fallidos };
    },
    onSuccess: ({ creados, fallidos }) => {
      queryClient.invalidateQueries({ queryKey: ["clientes", empresaId] });
      if (fallidos === 0) {
        toast.success(`Plantillas cargadas: ${creados} clientes`);
      } else {
        toast.warning(`Plantillas cargadas parcialmente: ${creados} creados, ${fallidos} omitidos`);
      }
    },
    onError: (err: unknown) => {
      const msg =
        typeof err === "object" && err !== null && "message" in err
          ? (err as { message: string }).message
          : "No se pudieron cargar las plantillas";
      toast.error(msg);
    },
  });

  const filtered = clientes.filter((c) =>
    search
      ? c.nombre.toLowerCase().includes(search.toLowerCase()) ||
        c.nif?.toLowerCase().includes(search.toLowerCase()) ||
        c.email?.toLowerCase().includes(search.toLowerCase())
      : true
  );

  const handleEdit = (c: ClienteRow) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };

  const handleDelete = (c: ClienteRow) => {
    if (!empresaId) return;
    if (!window.confirm(`¿Eliminar a "${c.nombre}"? Esta acción no se puede deshacer.`)) return;
    deleteMutation.mutate({ id: c.id, empresaId });
  };

  const handleSeedTemplates = () => {
    if (seedTemplatesMutation.isPending) return;
    if (!window.confirm("Se crearán 9 clientes de prueba (3 públicas, 3 privadas y 3 autónomos). ¿Continuar?")) {
      return;
    }
    seedTemplatesMutation.mutate();
  };

  if (!empresaId) {
    return (
      <p className="text-sm text-muted-foreground">
        Selecciona una empresa para gestionar clientes.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Clientes</h1>
          <span className="ml-1 text-xs text-muted-foreground">
            ({clientes.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSeedTemplates}
            disabled={seedTemplatesMutation.isPending}
            className="gap-2"
          >
            {seedTemplatesMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Cargar plantillas prueba
          </Button>
          <Button onClick={handleNew} className="gap-2">
            <Plus className="size-4" />
            Nuevo cliente
          </Button>
        </div>
      </div>

      {/* ── Buscador ─────────────────────────────────────────────────────── */}
      <Input
        placeholder="Buscar por nombre, NIF o email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      {/* ── Tabla ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Clientes registrados</CardTitle>
          <CardDescription>
            {filtered.length} de {clientes.length} mostrados
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search ? "Sin resultados para esa búsqueda." : "Todavía no hay clientes."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Razón social</TableHead>
                    <TableHead>NIF / CIF</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.nombre}
                        {c.nombre_comercial && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({c.nombre_comercial})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.nif ?? "—"}
                      </TableCell>
                      <TableCell>{tipoEntidadBadge(c.tipo_entidad)}</TableCell>
                      <TableCell className="text-xs">{c.email ?? "—"}</TableCell>
                      <TableCell className="text-xs">{c.telefono ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => handleEdit(c)}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(c)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Dialog de creación / edición ─────────────────────────────────── */}
      {dialogOpen && (
        <ClienteDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          empresaId={empresaId}
          editing={editing}
        />
      )}
    </div>
  );
}
