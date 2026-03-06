🌐 **Languages:** [🇪🇸 Español](README.md) | [🇬🇧 English](README.en.md) | [🇨🇳 中文](README.zh.md) | [🇧🇷 Português](README.pt.md)

---

# Factelo
<img width="896" height="617" alt="Dashboard" src="https://github.com/user-attachments/assets/55f3121e-4d75-4a21-9eba-66d033033f0d" />

基于 React、Vite、Rust 和 Tauri 构建的跨平台电子发票系统。本项目旨在为希望修改、分发和商业化该应用程序的开发者提供支持，前提是必须始终保留原始代码的版权声明。

## 技术架构
- **前端 (Frontend):** React + Vite + TypeScript + TailwindCSS
- **桌面端后端 (Backend):** Rust + Tauri (原生跨平台集成)
- **状态管理:** Zustand, React Query
- **UI 组件库:** Radix UI, Lucide React
- **图表:** Recharts
- **表单验证:** Zod, React Hook Form
- **Tauri 插件:** Dialog, Log, Updater, Shell, FS

## 核心目录结构
```text
├── src/                # React 前端代码
│   ├── components/     # UI 组件和布局
│   ├── hooks/          # 自定义 Hooks
│   ├── lib/            # 工具函数和公共逻辑
│   ├── pages/          # 主要页面视图
│   ├── stores/         # 全局状态 (Zustand)
│   ├── styles/         # 全局样式
│   ├── types/          # TypeScript 类型定义
├── src-tauri/          # Rust 后端代码 (Tauri)
│   ├── src/            # Rust 模块
│   ├── migrations/     # SQL 数据库迁移
│   ├── data/           # 数据模式
│   ├── templates/      # HTML 模板
```

## 安装与开发环境
1. **安装依赖项:**
   ```bash
   npm install
   ```
2. **启动前端开发服务器:**
   ```bash
   npm run dev
   ```
3. **启动桌面端开发环境 (Tauri):**
   - 安装 [Rust](https://www.rust-lang.org/tools/install)
   - 安装 [Tauri CLI](https://tauri.app/):
     ```bash
     cargo install tauri-cli
     ```
   - 运行桌面应用:
     ```bash
     npm run tauri -- dev
     ```

## 构建与分发
- **前端打包:**
  ```bash
  npm run build
  ```
- **桌面端 (跨平台发布):**
  利用 GitHub Actions (`.github/workflows/release.yml`) 自动编译并发布适用于 Windows、macOS 和 Linux 的二进制文件。

## 许可证与版权
本软件采用修改后的 MIT 许可证进行分发：
- 您可以自由修改、分发和商业化此代码。
- **在任何重新分发或衍生作品中，必须始终保留原始版权声明。**
- 声明示例:
  ```text
  Copyright (c) 2026 Luis C. and original contributors. All rights reserved.
  ```

## 项目状态

> **本项目已停止维护 (Discontinued)。**
>
> Factelo 目前尚未集成西班牙税务局的 Veri*factu 系统，也未完全适配 2026-2027 年的西班牙新法规。在完成这些法律和技术合规要求之前，建议不要在生产环境中使用。

## 主要功能

### 1. 电子发票管理
<img width="1048" height="617" alt="crear factura" src="https://github.com/user-attachments/assets/450e9457-bdcc-4b25-b363-83bd1427ede7" />

- 创建、编辑、开具和取消发票。
- 支持红字发票和公共机构发票。
- 生成防篡改的哈希链 (Veri*factu 标准)。
- 支持导出 PDF 和 Facturae 3.2.x 格式。

### 2. 客户与产品管理
- 客户信息登记（税务数据、地址）。
- 包含价格和增值税 (VAT) 的产品及服务目录。

### 3. 数据看板与高级分析
<img width="896" height="616" alt="analitica" src="https://github.com/user-attachments/assets/a70c6c74-a569-4fcb-b484-9ca63d42e88c" />

- KPI 指标：总开票额、进销项增值税、未结清发票。
- 高级统计：客户 ABC 分析 (帕累托法则)、DSO (平均收款延迟天数)、开票热力图。

---

## MIT License
Copyright (c) 2026 Luis C. and original contributors
本项目按“原样”提供，不附带任何明示或暗示的担保。
