// 「常用默认表」快捷选择的可用性校验（0903 欠账 A2）。
//
// 背景：这四个表 ID 是硬编码的（同事 e1f9290 加的），而 2026-09-05 实测**四个在真实后端全都
// 不存在**——`config/entryType?typeId=` 一律回 `{success:false, msg:"未找到相关ID…"}`。
// 它们其实是 mock 数据里的 ID（见 api/mock/entries.ts / sources.ts），所以这个功能从来只在
// mock 下成立。
//
// 之前点一下会把输出表设成一个无效 ID，出参随即变成「共 0 个可选」，而**界面上没有任何报错**，
// 用户只会以为"这张表没字段"。
//
// 做法：渲染前逐个校验，只留下真实存在的；一个都不剩就整行不显示。
//   - 真实环境（今天）→ 这一行自动消失，不再有死按钮
//   - 哪天这些表被建出来、或有人改了名单 → 自动恢复
//   - mock 环境 → 照旧可用
// 不硬删这一行，是因为"常用表"这个能力本身没问题，坏的只是那份写死的名单。
//
// 校验结果按 tableId 进程级缓存：这个面板会被反复打开，同一个 ID 不必每次都问一遍后端。
import { ref, type Ref } from 'vue'
import { entryApi } from '@/api'

export interface PresetTable {
  name: string
  tableId: string
}

/** tableId → 是否存在；进行中的请求以 Promise 占位，避免同一 ID 并发重复查询 */
const cache = new Map<string, boolean | Promise<boolean>>()

async function checkOne(tableId: string): Promise<boolean> {
  const cached = cache.get(tableId)
  if (typeof cached === 'boolean') return cached
  if (cached) return cached
  const pending = (async () => {
    try {
      const entry = await entryApi.entryDetail(tableId)
      // 后端 success:false 时 request() 会抛；万一改成回空对象，这里也要判出来
      const ok = !!entry?.tableId
      cache.set(tableId, ok)
      return ok
    } catch {
      cache.set(tableId, false)
      return false
    }
  })()
  cache.set(tableId, pending)
  return pending
}

/**
 * 过滤出真实存在的常用表。返回的是 ref，校验完成后自动更新；校验期间为空数组
 * （宁可先不显示，也不要先显示出来再消失，或者让人点到一个无效的）。
 */
export function usePresetTables(presets: PresetTable[]): { availablePresets: Ref<PresetTable[]> } {
  const availablePresets = ref<PresetTable[]>([])
  void Promise.all(presets.map(async (p) => ((await checkOne(p.tableId)) ? p : null)))
    .then((list) => { availablePresets.value = list.filter((p): p is PresetTable => !!p) })
  return { availablePresets }
}

/** 仅供测试重置进程级缓存 */
export function __resetPresetTableCache() {
  cache.clear()
}
