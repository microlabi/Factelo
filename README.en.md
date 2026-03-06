🌐 **Languages:** [🇪🇸 Español](README.md) | [🇬🇧 English](README.en.md)

---

# Factelo
<img width="896" height="617" alt="Dashboard" src="https://github.com/user-attachments/assets/55f3121e-4d75-4a21-9eba-66d033033f0d" />

Cross-platform electronic invoicing system built with React, Vite, Rust, and Tauri. This project is aimed at developers looking to modify, distribute, and monetize the application, while always maintaining acknowledgment of the original code's copyright.

## Architecture
- **Frontend:** React + Vite + TypeScript + TailwindCSS
- **Desktop Backend:** Rust + Tauri (native cross-platform integration)
- **State Management:** Zustand, React Query
- **UI:** Radix UI, Lucide React
- **Charts:** Recharts
- **Validation:** Zod, React Hook Form
- **Tauri Plugins:** Dialog, Log, Updater, Shell, FS

## Main Structure
```text
├── src/                # React Frontend
│   ├── components/     # UI components and layout
│   ├── hooks/          # Custom hooks
│   ├── lib/            # Shared utilities and logic
│   ├── pages/          # Main views
│   ├── stores/         # Global state (Zustand)
│   ├── styles/         # Global styles
│   ├── types/          # TypeScript types
├── src-tauri/          # Rust Backend (Tauri)
│   ├── src/            # Rust modules
│   ├── migrations/     # SQL migrations
│   ├── data/           # Schemas and data
│   ├── templates/      # HTML templates
```

## Installation and Development
1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Frontend development:**
   ```bash
   npm run dev
   ```
3. **Desktop development (Tauri):**
   - Install [Rust](https://www.rust-lang.org/tools/install)
   - Install [Tauri CLI](https://tauri.app/):
     ```bash
     cargo install tauri-cli
     ```
   - Run desktop app:
     ```bash
     npm run tauri -- dev
     ```

## Build and Distribution
- **Frontend:**
  ```bash
  npm run build
  ```
- **Desktop (cross-platform release):**
  Uses GitHub Actions (`.github/workflows/release.yml`) to compile and publish binaries for Windows, macOS, and Linux.

## QA and Testing
- The project uses TypeScript and validations with Zod.
- It is recommended to add unit and integration tests for Rust and React.
- Continuous integration via GitHub Actions.

## License and Copyright
This software is distributed under a modified MIT license:
- You can modify, distribute, and monetize the code.
- **You must always keep the original copyright notice** in any redistribution or derivative work.
- Notice example:
  ```text
  Copyright (c) 2026 Luis C. and original contributors. All rights reserved.
  ```
- For contributions, use PRs and maintain author traceability in the Git history.

## Contact and Support
For support, suggestions, or contributions, open an issue or PR in the public repository.

## Contribution Example (Pull Request)
1. Fork the repository and create a descriptive branch:
   ```bash
   git checkout -b fix/bug-description
   ```
2. Make your changes and ensure the project compiles and passes tests.
3. Commit and push:
   ```bash
   git commit -m "Fix bug in NIF validation"
   git push origin fix/bug-description
   ```
4. Open a Pull Request explaining the change and reference related issues.

## Extensibility Guide
- You can create new modules in `src-tauri/src/` for backend logic in Rust.
- React components can be extended in `src/components/` and views in `src/pages/`.
- To add endpoints, create new commands in `src-tauri/src/commands.rs` and expose them with `#[tauri::command]`.
- Use custom hooks in `src/hooks/` for reusable frontend logic.

## Basic API Documentation (Tauri Commands)
Main endpoints are exposed as Tauri commands. Example endpoint to create an invoice:

```rust
#[tauri::command]
pub async fn insert_factura(state: tauri::State<'_, DbPool>, input: InsertFacturaInput) -> CommandResult<InsertFacturaResponse>
```
- **Input:** Invoice data (`empresa_id`, `cliente_id`, `lineas`, etc.)
- **Output:** Invoice ID and registration hashes.
- You can query/create/update entities such as clients, products, series, and companies using similar commands.

For more details, review `src-tauri/src/commands.rs` and the Tauri documentation.

## Security Best Practices
- Never upload private keys, passwords, tokens, or `.env` files to the public repository.
- Always use environment variables and secrets in CI/CD (GitHub Actions) for sensitive credentials.
- Review `.gitignore` to exclude database files, backups, and temporary artifacts.
- If any test key was exposed, revoke it and generate a new one before publishing.
- Audit the code and configuration before each publication to prevent information leaks.

## Project Status

> **This project is discontinued.**
>
> Factelo currently does not have Veri*factu integration or a testing environment with the Spanish Tax Agency (Hacienda), and is not fully adapted to the new 2026-2027 Spanish legislation. It is recommended not to use it in production until these legal and technical requirements are implemented.

## Main Features

### 1. Electronic Invoicing
<img width="1048" height="617" alt="crear factura" src="https://github.com/user-attachments/assets/450e9457-bdcc-4b25-b363-83bd1427ede7" />

- Create, edit, issue, and cancel invoices.
- Support for corrective invoices and public entities (signature + registration).
- Selection of client, series, date, and billed concepts.
- Visual calculation of amounts (base, VAT, total) and final validation in Rust backend.
- Generation of chained hash for unalterable registration (Veri*factu).
- Export invoice in PDF and Facturae 3.2.x format (signature with AutoFirma).

### 2. Client Management
- Create, edit, and delete clients.
- Fiscal, contact, and address fields.
- Client list and search.

### 3. Product and Service Management
- Create, edit, and delete products/services.
- Catalog with prices, VAT, and references.
- Quick selection in the invoice.

### 4. Invoicing Series
<img width="1048" height="617" alt="crear factura" src="https://github.com/user-attachments/assets/5a7c9214-0035-44ea-8264-ddd515394f68" />

- Series configuration (prefix, numbering).
- Assignment of series to each invoice.

### 5. Companies
- Create and edit companies (fiscal data, logo, digital certificate).
- Multi-company: each user can manage several companies.

### 6. Dashboard and Analytics
<img width="896" height="616" alt="analitica" src="https://github.com/user-attachments/assets/a70c6c74-a569-4fcb-b484-9ca63d42e88c" />

- KPIs: total invoicing, output/input VAT, pending invoices, issued in the month, monthly variation.
- Income, expense, and temporal evolution charts.
- Advanced statistics: Client ABC, DSO (Days Sales Outstanding), invoicing heatmap.

<img width="898" height="614" alt="estadisticas" src="https://github.com/user-attachments/assets/abe37e81-826e-4479-a0e4-f0ee7d42ce8e" />

### 7. Expenses
- Registration and management of expenses and input VAT.
- Linking expenses to company and period.

### 8. Configuration
- Application preferences (theme, language, backup).
- Backup management and restoration.

### 9. Security and Integrity
- Hash chain for unalterable registration (Veri*factu).
- Integrity check on every startup and before exporting.
- Event and log auditing.

### 10. Export and Inspection
- Export invoices and data in PDF, Facturae XML, and tax inspection file format.
- Generation of legal QR for AEAT.

### 11. Onboarding
- Initial configuration wizard: company, series, and user.
- Requirement check before issuing the first invoice.

### 12. Updates
- Automatic update system via Tauri Updater.

### 13. Notifications
- Visual alerts and notifications for important events (errors, success, integrity).

### 14. Extensibility
- Modular Rust backend: you can create new commands in `src-tauri/src/commands.rs`.
- Extensible React frontend: components in `src/components/`, views in `src/pages/`.
- Custom hooks for reusable logic.

---

## MIT License

Copyright (c) 2026 Luis C. and original contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
