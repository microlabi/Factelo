import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InvoiceForm } from "@/components/invoices/InvoiceForm";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

export function InvoiceNewPage() {
  return (
    <div className="space-y-5">
      {/* Breadcrumb / cabecera de página */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-8 shrink-0" asChild>
            <Link to="/facturas">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">
                Nueva factura
              </h2>
              <Badge variant="secondary" className="text-xs">
                <FileText className="mr-1 size-3" />
                Borrador
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Rellena los datos del encabezado y añade los conceptos facturados.
            </p>
          </div>
        </div>
      </div>

      {/* Formulario principal */}
      <ErrorBoundary>
        <InvoiceForm />
      </ErrorBoundary>
    </div>
  );
}
