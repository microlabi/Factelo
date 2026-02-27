import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, Plus, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

function eurosToCents(value: number): number {
  return Math.round(value * 100);
}

export function ProductosPage() {
  const empresa = useSessionStore(selectEmpresa);
  const empresaId = empresa?.id;
  const queryClient = useQueryClient();

  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("0");
  const [tipoIva, setTipoIva] = useState("21");

  const { data: productos = [], isLoading } = useQuery({
    queryKey: ["productos", empresaId],
    queryFn: () => api.obtenerProductos(empresaId as number),
    enabled: !!empresaId,
  });

  const createMutation = useMutation({
    mutationFn: api.crearProducto,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["productos", empresaId] });
      setNombre("");
      setPrecio("0");
      setTipoIva("21");
      toast.success("Producto/servicio creado correctamente");
    },
    onError: (error: unknown) => {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? (error as { message: string }).message
          : "No se pudo crear el producto";
      toast.error(message);
    },
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!empresaId || !nombre.trim()) return;

    const precioNumero = Number(precio.replace(",", "."));
    const ivaNumero = Number(tipoIva.replace(",", "."));

    createMutation.mutate({
      empresa_id: empresaId,
      nombre: nombre.trim(),
      precio_unitario: eurosToCents(Number.isFinite(precioNumero) ? precioNumero : 0),
      tipo_iva: Number.isFinite(ivaNumero) ? ivaNumero : 21,
    });
  };

  if (!empresaId) {
    return <p className="text-sm text-muted-foreground">Selecciona una empresa para gestionar productos.</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="size-4" />
            Nuevo producto / servicio
          </CardTitle>
          <CardDescription>Añade conceptos reutilizables para facturación.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label htmlFor="prod-nombre">Nombre *</Label>
              <Input id="prod-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Consultoría mensual" />
            </div>
            <div>
              <Label htmlFor="prod-precio">Precio (€)</Label>
              <Input id="prod-precio" value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <Label htmlFor="prod-iva">IVA (%)</Label>
              <Input id="prod-iva" value={tipoIva} onChange={(e) => setTipoIva(e.target.value)} inputMode="decimal" />
            </div>
            <div className="md:col-span-4">
              <Button type="submit" disabled={createMutation.isPending || !nombre.trim()} className="gap-2">
                {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Añadir producto
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Productos y servicios</CardTitle>
          <CardDescription>{productos.length} registro(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">IVA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={3}>Cargando productos…</TableCell></TableRow>
              ) : productos.length === 0 ? (
                <TableRow><TableCell colSpan={3}>No hay productos todavía.</TableCell></TableRow>
              ) : (
                productos.map((producto) => (
                  <TableRow key={producto.id}>
                    <TableCell>{producto.nombre}</TableCell>
                    <TableCell className="text-right">{formatCurrency(producto.precio_unitario / 100)}</TableCell>
                    <TableCell className="text-right">{producto.tipo_iva.toFixed(1)}%</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
