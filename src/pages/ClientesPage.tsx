import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users, Plus, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { useSessionStore, selectEmpresa } from "@/stores/sessionStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function ClientesPage() {
  const empresa = useSessionStore(selectEmpresa);
  const empresaId = empresa?.id;
  const queryClient = useQueryClient();

  const [nombre, setNombre] = useState("");
  const [nif, setNif] = useState("");
  const [email, setEmail] = useState("");

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ["clientes", empresaId],
    queryFn: () => api.obtenerClientes(empresaId as number),
    enabled: !!empresaId,
  });

  const createMutation = useMutation({
    mutationFn: api.crearCliente,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clientes", empresaId] });
      setNombre("");
      setNif("");
      setEmail("");
      toast.success("Cliente creado correctamente");
    },
    onError: (error: unknown) => {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? (error as { message: string }).message
          : "No se pudo crear el cliente";
      toast.error(message);
    },
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!empresaId || !nombre.trim()) return;

    createMutation.mutate({
      empresa_id: empresaId,
      nombre: nombre.trim(),
      nif: nif.trim() || undefined,
      email: email.trim() || undefined,
    });
  };

  if (!empresaId) {
    return <p className="text-sm text-muted-foreground">Selecciona una empresa para gestionar clientes.</p>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4" />
            Nuevo cliente
          </CardTitle>
          <CardDescription>Añade clientes para poder emitir facturas.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label htmlFor="cliente-nombre">Nombre *</Label>
              <Input id="cliente-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Cliente SL" />
            </div>
            <div>
              <Label htmlFor="cliente-nif">NIF</Label>
              <Input id="cliente-nif" value={nif} onChange={(e) => setNif(e.target.value)} placeholder="B12345678" />
            </div>
            <div>
              <Label htmlFor="cliente-email">Email</Label>
              <Input id="cliente-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contacto@cliente.es" />
            </div>
            <div className="md:col-span-4">
              <Button type="submit" disabled={createMutation.isPending || !nombre.trim()} className="gap-2">
                {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Añadir cliente
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clientes registrados</CardTitle>
          <CardDescription>{clientes.length} cliente(s)</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>NIF</TableHead>
                <TableHead>Email</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={3}>Cargando clientes…</TableCell></TableRow>
              ) : clientes.length === 0 ? (
                <TableRow><TableCell colSpan={3}>No hay clientes todavía.</TableCell></TableRow>
              ) : (
                clientes.map((cliente) => (
                  <TableRow key={cliente.id}>
                    <TableCell>{cliente.nombre}</TableCell>
                    <TableCell>{cliente.nif ?? "—"}</TableCell>
                    <TableCell>{cliente.email ?? "—"}</TableCell>
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
