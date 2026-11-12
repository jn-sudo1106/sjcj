# source/
源管理：左侧侧栏的源列表 + 加源弹窗 + 分类选择

- SiteSourceSwitcher.vue: 源侧栏（含加源弹窗 + 普通/参数源分支）
- ParamSourceEditor.vue: 参数源编辑器（加源/编辑/只读三态复用）
- EditParamSourceDialog.vue: 编辑参数源弹窗
- SourceTabsBar.vue: 源页签栏（index.vue 引用）
- CategoryTreePicker.vue: 源分类选择（index.vue 引用）

**不在本目录**（§十-#1 定案）：
- `ParamEditorDrawer.vue` → 已上提 `components/param/`（RuleAssets + FlowCanvas 共用）
- `ParamTab.vue` → 留在 `views/RuleAssets/`（它是规则资产的「参数」tab，非本模块职责）

**依赖**：canvas/, stores/flow, components/param/ParamEditorDrawer
**被依赖**：inspector/ParamConfigTab 引用 ParamSourceEditor 作只读摘要
