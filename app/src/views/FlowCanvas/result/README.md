# result/
结果 / 数据查看：抓取结果、文件、任务、对比、表格数据的查看态 UI

- ResultView.vue: 结果视图
- FileView.vue: 文件视图
- TaskView.vue: 任务视图
- SiteDetailView.vue: FileView/ResultView/TaskView 的容器
- CompareSplit.vue: 对比分栏
- CompareResultPane.vue: 对比结果面板（仅 CompareSplit 引用）
- DataGrid.vue: 数据表格（ResultView / CompareResultPane / TableDataDialog / SiteDataView 共用）；「列」打开勾选+顺序弹窗
- TableDataDialog.vue: 表格数据弹窗（包装 DataGrid）
- ProcessNodeRail.vue: 进度节点轨（FileView/ResultView/TaskView 共用，result 内部共享）
- SiteMonitorView.vue: 监控视图容器（0916 起是「监控结果 / 监控配置」两 Tab 的壳，子 Tab 落 URL 的 monitorTab）
- SiteMonitorResultView.vue: 监控结果（监控列表 + 启停 + 日志，0910 从旧平台 MonitorList 迁入）
- SiteMonitorConfigView.vue: 监控配置（按源 + 数据监控节点配置告警，复用 inspector/AlertConfigPanel）

**依赖**：shared/CanvasHeader
**被依赖**：index.vue 直接引用 SiteDetailView

> 本子模块因附录 K 而新增（§十-#7 定案）：原计划只拆 4 个子模块，
> 但这 9 个文件互相引用、且不被 canvas/inspector/source 引用，
> 是独立的第 5 个职责，硬塞进其他三个筐会破坏「一个目录一个职责」（§3.2）。

> ⚠️ 修正 plan §A.4.1 一处错误：原 plan 写 "依赖 shared/CanvasHeader, shared/ProcessNodeRail"，
> 但 K.2 实测 ProcessNodeRail 在 result/ 内、不在 shared/（shared/ 只放跨子目录共享代码）。
> 本 README 按 K.2 修正。
