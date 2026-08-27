// entryApi.entryPaged（表分页列表）真实后端每行 items 恒为 null，从不带字段级 schema（2026-08-26 实测，
// entryTypeId=900：entryPaged 返回 items:null，entryDetail 才有 24 个真实字段）；字段列表只能按 tableId
// 单独查 entryApi.entryDetail 补齐。按 tableId 缓存，避免同一张表被多个 Tab/多次切换节点重复请求
// （同类按需缓存已见 useRuleTableFields.ts，这里是给非规则节点的表配置/进入条件/分支条件共用的通用版）。
import { type Ref } from 'vue'
import { entryApi, type EntryType } from '@/api'

export function useEntryTableFieldsCache(tables: Ref<EntryType[]>) {
  const loaded = new Set<string>()
  async function ensureTableFields(tableId: string | undefined) {
    if (!tableId || loaded.has(tableId)) return
    loaded.add(tableId)
    try {
      const detail = await entryApi.entryDetail(tableId)
      const idx = tables.value.findIndex((t) => t.tableId === tableId)
      if (idx >= 0) tables.value = [...tables.value.slice(0, idx), detail, ...tables.value.slice(idx + 1)]
      else tables.value = [...tables.value, detail]
    } catch {
      loaded.delete(tableId) // 失败不缓存，允许下次重试
    }
  }
  return { ensureTableFields }
}

/** entryPaged 的表清单和 ensureTableFields 的单表详情各自异步、谁先回来不确定——如果调用方拿到
 *  entryPaged 结果后直接 `tables.value = list` 整体覆盖，先落地的详情会被后到的清单原样冲掉（2026-08-26
 *  实测踩到：详情请求更小更快，经常先резolve，随后清单请求把刚合并进去的 24 个字段又换回空数组）。
 *  用这个合并：清单只用来补新表/基础信息，已经查过详情（fields 非空）的表保留原样。 */
export function mergeEntryTypesPreservingFields(current: EntryType[], incoming: EntryType[]): EntryType[] {
  const detailed = new Map(current.filter((t) => t.fields.length).map((t) => [t.tableId, t]))
  return incoming.map((t) => detailed.get(t.tableId) ?? t)
}
