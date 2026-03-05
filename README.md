# Factelo
<img width="896" height="617" alt="Dashboard" src="https://github.com/user-attachments/assets/55f3121e-4d75-4a21-9eba-66d033033f0d" />
-

Sistema de facturación electrónica multiplataforma, construido con React, Vite, Rust y Tauri. Este proyecto está orientado a desarrolladores que buscan modificar, distribuir y rentabilizar la aplicación, manteniendo siempre el reconocimiento de los derechos de autor del código original.

## Arquitectura
- **Frontend:** React + Vite + TypeScript + TailwindCSS
- **Backend Desktop:** Rust + Tauri (integración nativa multiplataforma)
- **Gestión de estado:** Zustand, React Query
- **UI:** Radix UI, Lucide React
- **Gráficas:** Recharts
- **Validación:** Zod, React Hook Form
- **Plugins Tauri:** Diálogo, Log, Updater, Shell, FS

## Estructura principal
```
├── src/                # Frontend React
│   ├── components/     # Componentes UI y layout
│   ├── hooks/          # Hooks personalizados
│   ├── lib/            # Utilidades y lógica compartida
│   ├── pages/          # Vistas principales
│   ├── stores/         # Estado global (Zustand)
│   ├── styles/         # Estilos globales
│   ├── types/          # Tipos TypeScript
├── src-tauri/          # Backend Rust (Tauri)
│   ├── src/            # Módulos Rust
│   ├── migrations/     # Migraciones SQL
│   ├── data/           # Esquemas y datos
│   ├── templates/      # Plantillas HTML
```

## Instalación y desarrollo
1. **Instalar dependencias:**
   ```bash
   npm install
   ```
2. **Desarrollo frontend:**
   ```bash
   npm run dev
   ```
3. **Desarrollo desktop (Tauri):**
   - Instalar [Rust](https://www.rust-lang.org/tools/install)
   - Instalar [Tauri CLI](https://tauri.app/):
     ```bash
     cargo install tauri-cli
     ```
   - Ejecutar app desktop:
     ```bash
     npm run tauri -- dev
     ```

## Build y distribución
- **Frontend:**
  ```bash
  npm run build
  ```
- **Desktop (release multiplataforma):**
  Utiliza GitHub Actions (`.github/workflows/release.yml`) para compilar y publicar binarios en Windows, macOS y Linux.

## QA y pruebas
- El proyecto utiliza TypeScript y validaciones con Zod.
- Se recomienda agregar tests unitarios y de integración para Rust y React.
- Integración continua vía GitHub Actions.

## Licencia y derechos de autor
Este software se distribuye bajo la licencia MIT modificada:
- Puedes modificar, distribuir y rentabilizar el código.
- **Siempre debes mantener el aviso de derechos de autor original** en cualquier redistribución o derivado.
- Ejemplo de aviso:
  ```
  Copyright (c) 2026 Luis C. y colaboradores originales. Todos los derechos reservados.
  ```
- Para contribuciones, utiliza PRs y mantén la trazabilidad de autores en el historial de Git.

## Contacto y soporte
Para soporte, sugerencias o contribuciones, abre un issue o PR en el repositorio público.

## Ejemplo de contribución (Pull Request)
1. Haz un fork del repositorio y crea una rama descriptiva:
  ```bash
  git checkout -b fix/descripcion-bug

---

## Licencia MIT

Copyright (c) 2026 Luis C. y colaboradores originales

Se concede permiso, de forma gratuita, a cualquier persona que obtenga una copia de este software y los archivos de documentación asociados (el "Software"), para tratar el Software sin restricción, incluyendo sin limitación los derechos de usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y/o vender copias del Software, y permitir a las personas a quienes se les proporcione el Software a hacer lo mismo, sujeto a las siguientes condiciones:

El aviso de copyright anterior y este aviso de permiso se incluirán en todas las copias o partes sustanciales del Software.

EL SOFTWARE SE PROPORCIONA "TAL CUAL", SIN GARANTÍA DE NINGÚN TIPO, EXPRESA O IMPLÍCITA, INCLUYENDO PERO NO LIMITADO A LAS GARANTÍAS DE COMERCIALIZACIÓN, IDONEIDAD PARA UN PROPÓSITO PARTICULAR Y NO INFRACCIÓN. EN NINGÚN CASO LOS AUTORES O TITULARES DEL COPYRIGHT SERÁN RESPONSABLES DE NINGUNA RECLAMACIÓN, DAÑO O OTRA RESPONSABILIDAD, YA SEA EN UNA ACCIÓN CONTRACTUAL, AGRAVIO O DE OTRO TIPO, DERIVADA DE, O EN CONEXIÓN CON EL SOFTWARE O EL USO U OTRO TIPO DE ACCIONES EN EL SOFTWARE.
   ```
2. Realiza tus cambios y asegúrate de que el proyecto compila y pasa los tests.
3. Haz commit y push:
   ```bash
   git commit -m "Corrige bug en validación de NIF"
   git push origin fix/descripcion-bug
   ```
4. Abre un Pull Request explicando el cambio y referencia issues relacionados.

## Guía de extensibilidad
- Puedes crear nuevos módulos en `src-tauri/src/` para lógica backend en Rust.
- Los componentes React pueden extenderse en `src/components/` y las vistas en `src/pages/`.
- Para agregar endpoints, crea nuevos comandos en `src-tauri/src/commands.rs` y expón con `#[tauri::command]`.
- Usa hooks personalizados en `src/hooks/` para lógica reutilizable en frontend.

## Documentación básica de API (Tauri Commands)
Los endpoints principales se exponen como comandos Tauri. Ejemplo de endpoint para crear una factura:

```rust
#[tauri::command]
pub async fn insert_factura(state: tauri::State<'_, DbPool>, input: InsertFacturaInput) -> CommandResult<InsertFacturaResponse>
```
- **Input:** Datos de la factura (`empresa_id`, `cliente_id`, `lineas`, etc.)
- **Output:** ID de la factura y hashes de registro.
- Puedes consultar/crear/actualizar entidades como clientes, productos, series y empresas mediante comandos similares.

Para más detalles, revisa `src-tauri/src/commands.rs` y la documentación de Tauri.

## Buenas prácticas de seguridad
- Nunca subas claves privadas, contraseñas, tokens ni archivos `.env` al repositorio público.
- Usa siempre variables de entorno y secretos en CI/CD (GitHub Actions) para credenciales sensibles.
- Revisa `.gitignore` para excluir archivos de base de datos, backups y artefactos temporales.
- Si alguna clave de prueba fue expuesta, revócala y genera una nueva antes de publicar.
- Audita el código y configuración antes de cada publicación para evitar fugas de información.

## Estado del proyecto

> **Este proyecto está descontinuado.**
>
> Factelo no cuenta actualmente con integración verifactu ni entorno de pruebas con Hacienda, y no está adaptado completamente a la nueva legislación española 2026-2027. Se recomienda no usar en producción hasta que se implementen estos requisitos legales y técnicos.

## Funcionalidades principales

### 1. Facturación electrónica

<img width="1048" height="617" alt="crear factura" src="https://github.com/user-attachments/assets/450e9457-bdcc-4b25-b363-83bd1427ede7" />

- Crear, editar, emitir y anular facturas.
- Soporte para facturas rectificativas y entidades públicas (firma + registro).
- Selección de cliente, serie, fecha y conceptos facturados.
- Cálculo visual de importes (base, IVA, total) y validación final en backend Rust.
- Generación de hash encadenado para registro inalterable (Veri*factu).
- Exportación de factura en PDF y en formato Facturae 3.2.x (firma con AutoFirma).

### 2. Gestión de clientes
- Alta, edición y eliminación de clientes.
- Campos fiscales, contacto y dirección.
- Listado y búsqueda de clientes.

### 3. Gestión de productos y servicios
- Alta, edición y eliminación de productos/servicios.
- Catálogo con precios, IVA y referencias.
- Selección rápida en la factura.

### 4. Series de facturación

<img width="1048" height="617" alt="crear factura" src="https://github.com/user-attachments/assets/5a7c9214-0035-44ea-8264-ddd515394f68" />

- Configuración de series (prefijo, numeración).
- Asignación de serie a cada factura.

### 5. Empresas
- Alta y edición de empresas (datos fiscales, logo, certificado digital).
- Multiempresa: cada usuario puede gestionar varias empresas.

### 6. Dashboard y analítica

<img width="896" height="616" alt="analitica" src="https://github.com/user-attachments/assets/a70c6c74-a569-4fcb-b484-9ca63d42e88c" />

- KPIs: facturación total, IVA repercutido/soportado, facturas pendientes, emitidas en el mes, variación mensual.
- Gráficas de ingresos, gastos y evolución temporal.
- Estadísticas avanzadas: ABC de clientes, DSO (retraso medio de cobro), heatmap de facturación.

<img width="898" height="614" alt="estadisticas" src="https://github.com/user-attachments/assets/abe37e81-826e-4479-a0e4-f0ee7d42ce8e" />

### 7. Gastos
- Registro y gestión de gastos e IVA soportado.
- Vinculación de gastos a empresa y periodo.

### 8. Configuración
- Preferencias de la aplicación (tema, idioma, backup).
- Gestión de backups y restauración.

### 9. Seguridad e integridad
- Cadena de hashes para registro inalterable (Veri*factu).
- Verificación de integridad en cada arranque y antes de exportar.
- Auditoría de eventos y logs.

### 10. Exportación e inspección
- Exportación de facturas y datos en PDF, XML Facturae y fichero de inspección tributaria.
- Generación de QR legal para AEAT.

### 11. Onboarding
- Asistente de configuración inicial: empresa, serie y usuario.
- Verificación de requisitos antes de emitir la primera factura.

### 12. Actualizaciones
- Sistema de actualización automática vía Tauri Updater.

### 13. Notificaciones
- Alertas visuales y notificaciones de eventos importantes (errores, éxito, integridad).

### 14. Extensibilidad
- Backend Rust modular: puedes crear nuevos comandos en `src-tauri/src/commands.rs`.
- Frontend React extensible: componentes en `src/components/`, vistas en `src/pages/`.
- Hooks personalizados para lógica reutilizable.

---
Imágnes de la interfaz:
