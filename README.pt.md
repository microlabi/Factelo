🌐 **Idiomas:** [🇪🇸 Español](README.md) | [🇬🇧 English](README.en.md) | [🇨🇳 中文](README.zh.md) | [🇧🇷 Português](README.pt.md)

---

# Factelo
<img width="896" height="617" alt="Dashboard" src="https://github.com/user-attachments/assets/55f3121e-4d75-4a21-9eba-66d033033f0d" />

Sistema multiplataforma de faturamento eletrônico, construído com React, Vite, Rust e Tauri. Este projeto é voltado para desenvolvedores que buscam modificar, distribuir e rentabilizar o aplicativo, mantendo sempre o reconhecimento dos direitos autorais do código original.

## Arquitetura
- **Frontend:** React + Vite + TypeScript + TailwindCSS
- **Backend Desktop:** Rust + Tauri (integração nativa multiplataforma)
- **Gerenciamento de Estado:** Zustand, React Query
- **UI:** Radix UI, Lucide React
- **Gráficos:** Recharts
- **Validação:** Zod, React Hook Form
- **Plugins Tauri:** Dialog, Log, Updater, Shell, FS

## Estrutura Principal
```text
├── src/                # Frontend React
│   ├── components/     # Componentes UI e layout
│   ├── hooks/          # Hooks personalizados
│   ├── lib/            # Utilitários e lógica compartilhada
│   ├── pages/          # Telas principais
│   ├── stores/         # Estado global (Zustand)
│   ├── styles/         # Estilos globais
│   ├── types/          # Tipos TypeScript
├── src-tauri/          # Backend Rust (Tauri)
│   ├── src/            # Módulos Rust
│   ├── migrations/     # Migrações SQL
│   ├── data/           # Esquemas e dados
│   ├── templates/      # Templates HTML
```

## Instalação e Desenvolvimento
1. **Instalar dependências:**
   ```bash
   npm install
   ```
2. **Desenvolvimento frontend:**
   ```bash
   npm run dev
   ```
3. **Desenvolvimento desktop (Tauri):**
   - Instalar [Rust](https://www.rust-lang.org/tools/install)
   - Instalar [Tauri CLI](https://tauri.app/):
     ```bash
     cargo install tauri-cli
     ```
   - Executar app desktop:
     ```bash
     npm run tauri -- dev
     ```

## Build e Distribuição
- **Frontend:**
  ```bash
  npm run build
  ```
- **Desktop (release multiplataforma):**
  Utiliza GitHub Actions (`.github/workflows/release.yml`) para compilar e publicar binários em Windows, macOS e Linux.

## Licença e Direitos Autorais
Este software é distribuído sob a licença MIT modificada:
- Você pode modificar, distribuir e monetizar o código.
- **Você deve sempre manter o aviso de direitos autorais original** em qualquer redistribuição ou trabalho derivado.
- Exemplo de aviso:
  ```text
  Copyright (c) 2026 Luis C. e colaboradores originais. Todos os direitos reservados.
  ```

## Status do Projeto

> **Este projeto está descontinuado.**
>
> O Factelo atualmente não possui integração com o Veri*factu ou ambiente de testes com a Agência Tributária Espanhola (Hacienda), e não está totalmente adaptado à nova legislação espanhola 2026-2027. Recomenda-se não utilizá-lo em produção até que esses requisitos legais e técnicos sejam implementados.

## Principais Funcionalidades

### 1. Faturamento Eletrônico
<img width="1048" height="617" alt="crear factura" src="https://github.com/user-attachments/assets/450e9457-bdcc-4b25-b363-83bd1427ede7" />

- Criar, editar, emitir e cancelar faturas.
- Suporte para faturas retificativas e entidades públicas.
- Geração de hash encadeado para registro inalterável (Veri*factu).
- Exportação em PDF e formato Facturae 3.2.x.

### 2. Gestão de Clientes e Produtos
- Cadastro de clientes (dados fiscais, endereço).
- Catálogo de produtos e serviços com preços e IVA.

### 3. Dashboard e Analytics
<img width="896" height="616" alt="analitica" src="https://github.com/user-attachments/assets/a70c6c74-a569-4fcb-b484-9ca63d42e88c" />

- KPIs: faturamento total, IVA repercutido/suportado, faturas pendentes.
- Estatísticas avançadas: Curva ABC de clientes, DSO (atraso médio de recebimento), heatmap de faturamento.

---

## Licença MIT
Copyright (c) 2026 Luis C. e colaboradores originais
O código é fornecido "COMO ESTÁ", sem garantia de qualquer tipo.
