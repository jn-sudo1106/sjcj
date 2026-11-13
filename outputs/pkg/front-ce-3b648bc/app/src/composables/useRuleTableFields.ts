// 规则编排表字段的按需拉取与缓存（0804 S2-2 从 RuleOrchestrationTab 抽出，供表配置/编排配置两个 Tab 共用——
// 二者是互斥挂载的兄弟 Tab，各自独立缓存一份，不需要跨 Tab 共享状态）。
// 0805 改判：表/字段来源从 vrule（news-getTableFields）改回采集中心自己的 entryApi.entryDetail——
// 两边其实是同一份底层表注册表（entryTypeId/itemCode 编号空间共享，真机核对过），不需要单独一套查询；
// 选中输入/输出表时各按需拉一次并缓存，key 直接用 tableId（不再需要 dataSource 前缀，entryDetail 不分库）。
import { computed, ref, watch, type ComputedRef } from 'vue'
import { ElMessage } from 'element-plus'
import { entryApi, type RuleFieldOption, type RuleOrchestration } from '@/api'
import { ruleFieldOptionFromEntryField } from '@/utils/flow/ruleOrchestration'

export function useRuleTableFields(
  ruleCfg: ComputedRef<Pick<RuleOrchestration, 'inputTableId' | 'outputTableId'>>,
) {
  const tableFields = ref<Map<string, RuleFieldOption[]>>(new Map())
  async function ensureTableFields(tableId: string | undefined) {
    if (!tableId || tableFields.value.has(tableId)) return
    try {
      const entry = await entryApi.entryDetail(tableId)
      tableFields.value.set(tableId, entry.fields.map(ruleFieldOptionFromEntryField))
    } catch (e) {
      ElMessage.error(`加载表字段失败：${(e as Error)?.message ?? String(e)}`)
    }
  }
  watch(
    () => [ruleCfg.value.inputTableId, ruleCfg.value.outputTableId] as const,
    ([inputTableId, outputTableId]) => {
      ensureTableFields(inputTableId)
      ensureTableFields(outputTableId)
    },
    { immediate: true },
  )

  function fieldsOf(tableId: string | undefined): RuleFieldOption[] {
    if (!tableId) return []
    return tableFields.value.get(tableId) ?? []
  }
  const inputFieldOptions = computed(() => fieldsOf(ruleCfg.value.inputTableId))
  const outputFieldOptions = computed(() =>
    ruleCfg.value.outputTableId ? fieldsOf(ruleCfg.value.outputTableId) : inputFieldOptions.value,
  )

  return { inputFieldOptions, outputFieldOptions }
}
