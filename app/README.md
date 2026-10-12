# 采集配置中心 · 前端工程

数据采集平台的独立重构前端，品牌「青龙智能采集中心」。当前默认进入一级首页「采集资产总览」，再下钻到流程画布、采集资产、规则、指标、运行与监控等 7 个业务模块。全程 mock 数据，不直连后端；进入二期真接入时仅替换 `src/api` 数据适配层（`VITE_API_MODE=http`），界面与类型零改动。

## 技术栈

Vue 3 + Vite + TypeScript + Element Plus + Pinia + vue-router。流程画布为**自绘 SVG**（非第三方画布库），以精确控制节点 / 连线 / 插入点 / 拖拽重排。

## 命令

```bash
npm install
npm run dev       # 开发服务器
npm run build     # 类型检查(vue-tsc) + 生产构建
npm run preview   # 预览构建产物
npm run test      # 单元测试(Vitest)
npm run lint      # ESLint 检查（lint:fix 自动修复）
npm run format    # Prettier 格式化
npm run deploy    # 隔离部署（见下「部署」）
npm run deploy:head # 从已提交 HEAD 导出干净副本部署
```

## 目录结构

```
app/
├─ src/
│  ├─ api/                类型化接口层（方法名 = 真实 /v1 端点）
│  │  ├─ endpoints.ts       端点契约清单（150 条 + danger 标记，单一事实源）
│  │  ├─ client.ts          请求封装：VITE_API_MODE=mock|http 切换 + 未实现端点 fallback
│  │  ├─ index.ts           各域 API（overview/source/config/entry/param/rule/metric/data/run/monitor/item/workbench）
│  │  ├─ types.ts           领域模型 TS 类型
│  │  └─ mock/              按域分文件 mock（overview/sources/configs/entries/params/rules/metrics/dataview/runs/monitor/workbench/flows）
│  ├─ components/         通用组件（CountUp、PanePlaceholder）
│  ├─ design/             设计令牌 tokens.css（全局工具类 + Element Plus 主题对齐）
│  ├─ layouts/            AppShell：顶部系统栏 + 一级首页 + 分组导航 + 模块标题区
│  ├─ router/             首页 + 7 业务模块路由（懒加载）+ 导航元数据 tabs.ts
│  ├─ stores/             Pinia：flow（画布）/ runtime（试跑运行时）/ ui（模块动作总线）
│  └─ views/              Overview 首页 + 7 个业务模块（FlowCanvas / CollectAssets / RuleAssets / MetricCenter / DataView / RunRecords / Monitor）
├─ scripts/deploy-static.cjs   隔离部署脚本
├─ docs/组件与接口规格.md       组件 / 接口 / 设计系统规格
└─ src/**/*.test.ts            Vitest 用例（求值器 / 端点契约 / store）
```

## 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 脚手架 + 设计令牌 + 独立外壳 + 7 模块路由 + mock 骨架 | ✅ |
| M1 | 流程画布（自绘 SVG：节点库 / 插入点 / 右键菜单 / 拖拽重排 / 节点详情 / 连线子步骤） | ✅ |
| M2 | 采集资产（分类树 + 源表 + 详情抽屉 + 新建源向导 + 批量 + 写类二次确认） | ✅ |
| M3 | 规则资产（规则组 / 表达式 / 测试集 / 发布门禁 + 内嵌函数求值器） | ✅ |
| M4 | 指标中心 / 数据查看 / 运行记录 / 监控工具 | ✅ |
| M5a | 采集资产四 tab（源/配置/实体/参数）+ 源详情 26 字段 + 凭据脱敏 + 行内菜单 + 批量导入 | ✅ |
| M5b | 端点契约 147 条 + mock fallback + 组件规格文档 + 旧原型归档 | ✅ |
| 打磨 | 画布右侧数据驱动联动、节点库搜索、画布拖拽重排、工作台摘要接数 | ✅ |
| 工程化 | Vitest(17 例) + ESLint/Prettier + CI + 代码分割 + sjcj 隔离部署 | ✅ |
| 流程闭环 | 流程持久化（FlowDef + localStorage）+ mock 试跑闭环（试跑 → 节点 L→C → 运行记录 → 数据查看，run_id 贯穿） | ✅ |
| 首页总览 | `/overview` 一级首页：KPI、采集资产全景、任务趋势柱状图、二级资产类型分布、运行动态、告警和采集周期分布 | ✅ |

## 数据契约（mock-first）

- `endpoints.ts` 收录 150 个端点（按 14 域 + 本系统自有），方法名 = 真实 `/v1` 路径。
- 默认 `VITE_API_MODE=mock`：查 `mock/` 注册表；未实现专属 mock 的契约端点由 `client.ts` fallback（分页 → 空列表、写类 → 占位回执）。
- 切 `VITE_API_MODE=http` 即接真实后端；业务请求默认使用同源 `/api/v1/`，如需替换可设置 `VITE_API_BASE`。
- 写类 / 高危端点登记在 `DANGER_ENDPOINTS`（从契约 `danger` 派生），UI 统一二次确认占位、不落库。

## 登录与同源代理

- 验证码、登录、用户信息和退出默认请求同源 `/api`；业务接口默认请求同源 `/api/v1/`。
- 本地开发通过 `VITE_API_PROXY_TARGET` 设置后端地址；未设置时默认 `http://118.25.96.217:9999`（原 `115.227.21.133` 测试机已废弃）。旧变量 `VITE_AUTH_PROXY_TARGET` 仍兼容。
- 认证与业务请求都会携带 Cookie，并注入 `Access-Token` 请求头。
- 生产部署必须在静态站点所在域名配置 `/api` 反向代理到后端。Vite 的 `server.proxy` 只服务本地开发，不会写入静态构建产物。

## 部署（sjcj 子路径隔离）

对齐 `../设计稿/部署方案_隔离.md`：作为 WAN 公网入口下的隔离子路径 `/sjcj/` 托管 —— 不占端口、不起常驻服务，sjcj 侧只写 `/home/leo/sjcj/public`、**绝不写 WAN 目录**。当前默认入口为 **http://47.120.11.60:2806/sjcj/#/overview**，流程画布仍可通过 `#/canvas` 直接访问（WAN 原入口 `…/#deep-research` 不受影响）。部署分两部分：

### ① sjcj 静态产物（反复部署）

```bash
npm run deploy   # 构建（VITE_BASE=/sjcj/）+ git 守卫；未设 SJCJ_REMOTE_HOST 时只本地构建并打印发布命令
```

多人同时改代码时，推荐从仓库根目录使用一键部署入口：

```bash
node deploy.js
```

该入口调用 `scripts/deploy-from-head.cjs`，只部署已提交的 `HEAD`，不会把当前工作区未提交改动、设计稿或临时文件带到服务器。默认目标为 `leo@47.120.11.60:/home/leo/sjcj/public/`，SSH 端口 `5031`。如需密码登录，在本机通过 `SSHPASS` 环境变量提供，不要写入仓库。

实际服务器 SSH 为**密码登录**（`leo@47.120.11.60`，端口 `5031`；凭据见 wan 项目 `deploy.js`），与脚本默认的免密 rsync 不同，故产物用手动 rsync 发布（本机需 `sshpass`）：

```bash
SSHPASS='<password>' rsync -az --delete \
  -e "sshpass -e ssh -p 5031 -o StrictHostKeyChecking=accept-new" \
  dist/ leo@47.120.11.60:/home/leo/sjcj/public/
```

`scripts/deploy-static.cjs` 的安全保护：拒绝根路径 / 多层路径 / WAN 目录 / git 未提交·未推送·未同步。

### ② WAN 静态路由（一次性，属 wan 项目）

公网访问由 WAN 的 `server.js` 中 `/sjcj/` 路由（`resolveSjcjPath` → `/home/leo/sjcj/public`，无斜杠 302、未命中回落 `index.html`）托管。该路由是 wan 项目 `server.js` 的一次性纯增量改动（非 `/sjcj/` 请求行为不变），由 wan 自身的 `node deploy.js` 上线，并需在 **wan 仓库提交**，否则整树重部署会丢。sjcj 侧不直接改 / 重启 WAN。

## 边界

全程 mock；写类 / 高危（发抓取 / 发配置 / 启停 / 删除 / 批量 / 清缓存 / 清队列）首期只读、灰显或二次确认占位；登录凭据只存引用（CredentialRef）不存明文。设计口径见 `../设计稿/`，组件 / 接口规格见 `docs/组件与接口规格.md`。

## 使用手册

- 面向平台使用人员的完整操作手册（当前系统实际功能）：[`docs/使用手册.md`](docs/使用手册.md)。
- 新项目管理员接手、演示、验证和发布前，请先阅读 [`docs/管理员使用手册.md`](docs/管理员使用手册.md)（注：该手册为 2026-06-25 的 mock 演示态版本，已过时，仅作参考）。
