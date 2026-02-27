import { useEffect, useRef, useState } from "react";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";

type UpdaterStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installed"
  | "error";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function formatProgress(downloadedBytes: number, totalBytes?: number) {
  if (!totalBytes || totalBytes <= 0) return "Descargando actualización…";
  const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
  return `Descargando actualización… ${pct}%`;
}

export function useUpdater() {
  const checkedOnBoot = useRef(false);
  const [status, setStatus] = useState<UpdaterStatus>("idle");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);

  const installUpdate = async (update: Update) => {
    setStatus("downloading");

    let downloadedBytes = 0;
    let contentLength: number | undefined;
    const toastId = toast.loading("Descargando actualización…");

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
        }
        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          toast.loading(formatProgress(downloadedBytes, contentLength), { id: toastId });
        }
      });

      setStatus("installed");
      toast.success("Actualización instalada. Reinicia la aplicación para aplicar cambios.", {
        id: toastId,
        duration: 7000,
      });
    } catch (error: unknown) {
      setStatus("error");
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "Error desconocido al instalar actualización";
      toast.error(`No se pudo instalar la actualización: ${message}`, {
        id: toastId,
        duration: 8000,
      });
    }
  };

  useEffect(() => {
    if (checkedOnBoot.current) return;
    checkedOnBoot.current = true;

    if (!isTauriRuntime()) return;

    let cancelled = false;

    const checkForUpdates = async () => {
      setStatus("checking");
      try {
        const update = await check();

        if (!update) {
          setStatus("idle");
          return;
        }

        if (cancelled) {
          await update.close();
          return;
        }

        setAvailableUpdate(update);
        setStatus("available");

        toast.info(`Nueva versión disponible: ${update.version}`, {
          description:
            update.body ??
            `Versión actual: ${update.currentVersion}. Pulsa “Actualizar” para instalar.`,
          duration: 12000,
          action: {
            label: "Actualizar",
            onClick: () => {
              void installUpdate(update);
            },
          },
        });
      } catch (error: unknown) {
        setStatus("error");
        const message =
          typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : "Error desconocido al comprobar actualizaciones";
        toast.error(`No se pudo comprobar actualizaciones: ${message}`);
      }
    };

    void checkForUpdates();

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    status,
    availableVersion: availableUpdate?.version ?? null,
    installUpdate: availableUpdate
      ? () => installUpdate(availableUpdate)
      : null,
  };
}
