// NodeInspector 资产数据的 provide/inject 容器（P1-1 Step 4 · NodeInspector 拆 tab 子组件）。
//
// 这些 ref 由主壳 NodeInspector.vue 在 onMounted / loadRuleAssets 里加载一次并缓存，
// 各 tab 子组件只读消费（任务/表配置用 tables、任务参数标签用 params）。
// 用 provide/inject 而非 props：资产是跨 tab 共享的加载缓存，不属于某个 tab 的私有输入，
// 且 tab 不需要关心"何时加载/是否已加载"——主壳统一兜底（规则数据懒加载逻辑留主壳，见 NodeInspector.test.ts）。
//
// 设计约束（来自 NodeInspector.test.ts）：
//   - 规则 3 个 API 只在选中规则节点时调用一次，且不重复——loadRuleAssets + watch(isRule) 必须留主壳，
//     tab 不能自己 loadRuleAssets，否则每次 tab 切换/挂载都会重复请求。
//   - entryApi/paramApi 在 onMounted 拉一次——同样留主壳。
import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import type { EntryType, Param, RuleGroup, Rule, SharedConfig } from '@/api'
import { useEntryTableFieldsCache } from '@/composables/useEntryTableFieldsCache'

export interface NodeInspectorAssets {
  tables: Ref<EntryType[]>
  params: Ref<Param[]>
  ruleGroups: Ref<RuleGroup[]>
  rules: Ref<Rule[]>
  sharedCfgs: Ref<SharedConfig[]>
  /** entryPaged 表清单不带字段（见 useEntryTableFieldsCache 头注），tab 要用某张表的字段列表时先调这个补齐。 */
  ensureTableFields: (tableId: string | undefined) => void
}

const KEY: InjectionKey<NodeInspectorAssets> = Symbol('NodeInspectorAssets')

/** 主壳调用：创建 5 个资产 ref 并 provide，返回引用以便主壳加载/写入。 */
export function provideNodeInspectorAssets(): NodeInspectorAssets {
  const tables = ref<EntryType[]>([])
  const { ensureTableFields } = useEntryTableFieldsCache(tables)
  const assets: NodeInspectorAssets = {
    tables,
    params: ref([]),
    ruleGroups: ref([]),
    rules: ref([]),
    sharedCfgs: ref([]),
    ensureTableFields,
  }
  provide(KEY, assets)
  return assets
}

/** tab 子组件调用：读取主壳提供的资产 ref。在 NodeInspector 上下文外调用会抛错（防误用）。 */
export function useNodeInspectorAssets(): NodeInspectorAssets {
  const assets = inject(KEY)
  if (!assets) throw new Error('useNodeInspectorAssets() 必须在 NodeInspector 子组件内调用')
  return assets
}
