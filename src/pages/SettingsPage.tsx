import { Settings, Building2, ListChecks, DatabaseBackup } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmpresaTab } from "@/components/settings/EmpresaTab";
import { SeriesTab } from "@/components/settings/SeriesTab";
import { BackupsTab } from "@/components/settings/BackupsTab";

// ─── Definición de pestañas ───────────────────────────────────────────────────

const TABS = [
  {
    value: "empresa",
    label: "Empresa",
    icon: Building2,
    content: <EmpresaTab />,
  },
  {
    value: "series",
    label: "Series de facturación",
    icon: ListChecks,
    content: <SeriesTab />,
  },
  {
    value: "backups",
    label: "Backups & Seguridad",
    icon: DatabaseBackup,
    content: <BackupsTab />,
  },
] as const;

// ─── Página ───────────────────────────────────────────────────────────────────

export function SettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Cabecera */}
      <div className="flex items-center gap-3 border-b pb-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Settings className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Configuración</h1>
          <p className="text-sm text-muted-foreground">
            Gestiona los datos de tu empresa, series de facturación y copias de seguridad.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="empresa">
        <TabsList className="mb-6 h-auto w-full justify-start gap-1 bg-transparent p-0 border-b rounded-none">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="
                relative flex items-center gap-2 rounded-none border-b-2 border-transparent
                bg-transparent px-4 pb-3 pt-1 text-sm font-medium text-muted-foreground
                transition-none
                data-[state=active]:border-primary
                data-[state=active]:text-foreground
                data-[state=active]:bg-transparent
                data-[state=active]:shadow-none
                hover:text-foreground
              "
            >
              <Icon className="h-4 w-4" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map(({ value, content }) => (
          <TabsContent key={value} value={value} className="mt-0 focus-visible:outline-none focus-visible:ring-0">
            {content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
