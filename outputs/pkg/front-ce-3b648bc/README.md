# 青龙智能采集中心

数据采集平台的独立重构前端系统。本仓库包含前端工程与设计文档两部分。当前默认入口为一级首页「采集资产总览」，再下钻到 7 个业务模块。

## 系统概况

**在工作区中的位置**：`D:\workspace\cl` 分两条线——ChatBI 问数链（`ai_chat_chain`、`chat-bi-backend`、`bee-top-dev/bee-query`）与采集/数据同步链（本工程、`sync-platform`、`data-sync`）。本工程是**采集链唯一的用户界面**，问数链的界面不在这个仓。

**技术栈**：Vue 3 + Vite + TypeScript + Element Plus + Pinia + vue-router（`app/package.json`）。流程画布是自绘 SVG，不引第三方画布库。

**数据层是这个仓最需要先懂的一层**：所有请求收在 `app/src/api/`，业务方法统一走 `request()`，旧平台字段名到本项目类型的转换集中在 `app/src/api/legacyAdapters.ts`。端点契约清单是 `app/src/api/endpoints.ts`——每条记录带 `impl`（有没有专属 mock handler）与 `live`（是否已按真实后端联调、该端点自动切真实）两个标记，因此**默认 mock、逐端点上线**，不靠全局开关一刀切。写类端点另有一张生产写保护白名单（`app/src/api/client.ts`），不在名单里的写在发请求前就被拦下。

**对接的后端**：

- 业务后端 bee-config（`D:\workspace\cl\bee-top-dev`）——`config/*` 系列接口，例如实体表分页 `config/entryTypePagedView`
- 同步平台 sync-platform——走**同源 `/api/sync-platform` 代理**：`npm run dev` 与本机业务后端同机，`npm run test` 指向 133 公网 Nginx
- 模板配置域 `/api/poc`——独立进程，由 vite/nginx 直接转发，不经过业务后端

**运行与校验命令**（在 `app/` 下或仓库根目录）：`npm run dev`、`npm run build`（先 `vue-tsc` 类型检查再打包）、`npm run test:unit`（Vitest）、`npm run lint`、`npm run deploy` / `deploy:head`（隔离部署）。环境地址与部署惯例记在根目录 `AGENTS.md`：`npm run dev` 连本机 `127.0.0.1:9999`，`npm run test` 连 186 开发环境（原 dev 默认）。

**边界**：页面能点通不代表后端契约已验证——`live` 标记只说明该端点已切真实接口。新增页面动作若后端没有对应参数，前端不会自己变出过滤能力（这类缺口要在后端补）。


## 目录

| 目录 | 说明 |
|---|---|
| [`app/`](app/) | 前端工程（Vue 3 + Vite + TS）。详见 [app/README.md](app/README.md) |
| [`设计稿/`](设计稿/) | 方案、实测、逆向工程与部署文档 |

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

首次从根目录启动时会自动补装 `app/` 依赖。

## 设计文档（设计稿/）

- `采集配置中心_开发方案.md` — 工程落地方案与里程碑
- `数据中心现有功能逆向工程_2026-06-17.md` — 142 个 /v1 端点全貌
- `操作手册功能覆盖核对_2026-06-18.md` — 功能矩阵
- [`app/docs/管理员使用手册.md`](app/docs/管理员使用手册.md) — 面向新项目管理员的进度、使用与运维手册
- `源列表功能实测` / `新建源流程实测` — 字段级实测
- `采集配置中心_Figma设计风格指引.md` — 设计令牌
- `部署方案_隔离.md` — sjcj 子路径隔离部署

## 概览

- 全程 mock，二期真接入只换 `app/src/api` 适配层（界面零改动）
- 首页 + 7 业务模块：首页总览 / 流程画布 / 采集资产 / 规则资产 / 指标中心 / 数据查看 / 运行记录 / 监控工具
- 质量：Vitest 单元测试 + ESLint + CI（[.github/workflows/ci.yml](.github/workflows/ci.yml)）
- 部署：`node deploy.js` 可从已提交的 `HEAD` 导出干净副本并发布到公网 `/sjcj/` 子路径；默认访问 `http://47.120.11.60:2806/sjcj/#/overview`
