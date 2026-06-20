# 更新日志

## 0.1.0

### 里程碑
- **P0** 脚手架 + 设计令牌 + 独立外壳 + 7 模块路由 + mock 骨架
- **M1** 流程画布（自绘 SVG：节点库 / 插入点 / 右键菜单 / 节点详情 / 连线子步骤）
- **M2** 采集资产（源 / 分类树 / 详情抽屉 / 新建源向导 / 批量 + 写类二次确认）
- **M3** 规则资产（规则组 / 发布门禁 + 内嵌函数求值器）
- **M4** 指标中心 / 数据查看 / 运行记录 / 监控工具
- **M5a** 采集资产四 tab（源/配置/实体/参数）+ 源详情 26 字段 + 凭据脱敏 + 行内查询·变更菜单 + 模板源批量导入
- **M5b** 端点契约清单 147 条 + mock fallback + 组件接口规格文档 + 旧原型归档

### 打磨
- 流程画布右侧 NodeInspector / EdgeInspector：数据驱动 + 资产联动（输出表/参数/配置/凭据/规则）+ 修复 `.rc-field` 全局样式污染导致的错位
- 节点库搜索过滤、画布节点拖拽重排、工作台摘要接 mock

### 工程化
- Vitest 单元测试（17 例：函数求值器 / 端点契约一致性 / flow store）
- ESLint flat config + Prettier
- CI：lint + test + build（`.github/workflows/ci.yml`）
- 代码分割：element-plus 拆 `vendor-element` chunk，应用入口降至 ~56kB
- sjcj 子路径隔离部署脚本 `scripts/deploy-static.cjs`（含安全保护）

### 品牌
- 顶栏「万维数据采集中心」+ 立方体图标 + favicon；去除演示环境字样

### 清理
- 移除未使用的 `@vue-flow/*` 依赖（流程画布为自绘 SVG，从未引用）
