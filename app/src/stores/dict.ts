// 抓取类型字典（= 节点类型 = config.configType）运行时拉取。
//
// 痛点：flowModel.seeds.ts 的 SNATCH_TYPES 是按 2026-08-28 / 2026-09-07 两次实测
// GET /v1/config/sourceTypes 抄下来的快照（legacyEnums.test.ts 用 REAL_SOURCE_TYPES
// 表锁死「SNATCH_TYPES 与后端逐字一致」）。后端字典一旦变了，前端不通知就脏——
// 这是手动对表债，已两次踩坑（自造 [95]/[155]/[BROWSER] 等被后端打回、09-07 后端
// 新增 600/700 要手动同步）。本 store 在启动时拉一次后端字典：
//
//   - 成功且与快照一致 → 替换本地列表，no warn（仅是更新 lastSyncAt）；
//   - 成功但有漂移（后端多/少了条目，或编号/名称不一致）→ 替换 + console.warn
//     告警，附「同步 flowModel.seeds.ts 的 SNATCH_TYPES 与 legacyEnums.test.ts 的
//     REAL_SOURCE_TYPES」提示，把手动对表债转成自动信号；
//   - 后端返回空列表 / 请求失败 → 保持快照兜底，不清空。
//
// 同时校验 TEMPLATE_TO_SNATCH：每个模板映射串解析出的编号必须出自字典——
// 否则 configTypeFrom() 会写后端不识别的 configType（见 legacyAdapters.
// sourceTypeFromSnatchType 注释，0824-11 §1.2d 事故的同类风险）。
//
// 用户可见行为不变：节点库 LIB_GROUPS 是前端概念（包含 decision/parallel 等非字典
// 类型），用户从未在前端选过抓取类型——类型通过 TEMPLATE_TO_SNATCH 在插入节点时
// 设定。所以本 store 当前唯一的消费方是漂移检测 + 模板映射校验；将来加「按字典
// 过滤节点」「类型选择器」等能力时可直接读 snatchTypes。
//
// 分层：stores → views 是不推荐的依赖方向，但 stores/flow.ts 已从
// @/views/FlowCanvas/canvas/flowModel 导入 TEMPLATE_TO_SNATCH，本 store 沿用同惯例。
// 真要修分层，把 SNATCH_TYPES / TEMPLATE_TO_SNATCH / REAL_SOURCE_TYPES 三者一起
// 挪到 utils/flow/snatchTypes.ts 让两边都从那儿引；那是独立的小重构。
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { configApi } from '@/api'
import { SNATCH_TYPES, TEMPLATE_TO_SNATCH } from '@/views/FlowCanvas/canvas/flowModel'

function toOption(row: { sourceType: unknown; typeName: unknown }): string | null {
  const code = String(row.sourceType ?? '').trim()
  const name = String(row.typeName ?? '').trim()
  if (!code || !name) return null
  return `[${code}] - ${name}`
}

function parseCode(display: string): string | null {
  const m = display.match(/^\[(\d+)\]/)
  return m ? m[1] : null
}

export const useDictStore = defineStore('dict', () => {
  /** 抓取类型展示串列表，初始为 seeds 里的快照；load 成功后被后端值替换。 */
  const snatchTypes = ref<string[]>([...SNATCH_TYPES])
  /** 最近一次成功同步的 ISO 时间；null 表示从未成功过。 */
  const lastSyncAt = ref<string | null>(null)
  /** 当前是否在拉取中。 */
  const loading = ref(false)

  /**
   * 拉一次后端字典并校验。失败 / 空数据保持快照；漂移 / 模板映射越界会 warn。
   * 在 App.vue 启动时 fire-and-forget 调一次即可。
   */
  async function loadSnatchTypes(): Promise<void> {
    if (loading.value) return
    loading.value = true
    try {
      const remote = await configApi.sourceTypes()
      if (!Array.isArray(remote) || remote.length === 0) {
        // 后端返回空视为异常数据——空字典会把 configType 校验架空，宁可不动快照
        console.warn('[dict] config/sourceTypes 返回空列表，保持本地快照')
        return
      }
      const formatted = remote.map(toOption).filter((s): s is string => s !== null)
      if (formatted.length === 0) {
        console.warn('[dict] config/sourceTypes 全部条目格式不合法，保持本地快照')
        return
      }

      const snapshot = new Set(SNATCH_TYPES)
      const live = new Set(formatted)
      const onlyInBackend = [...live].filter((s) => !snapshot.has(s))
      const onlyInSnapshot = [...snapshot].filter((s) => !live.has(s))
      if (onlyInBackend.length || onlyInSnapshot.length) {
        console.warn(
          '[dict] 抓取类型字典与本地快照不一致：\n'
          + `  后端多出 ${onlyInBackend.length} 条: ${onlyInBackend.join(', ') || '（无）'}\n`
          + `  本地多出 ${onlyInSnapshot.length} 条: ${onlyInSnapshot.join(', ') || '（无）'}\n`
          + '  → 同步 flowModel.seeds.ts 的 SNATCH_TYPES 与 legacyEnums.test.ts 的 REAL_SOURCE_TYPES',
        )
      }

      // 校验 TEMPLATE_TO_SNATCH：模板映射串解析出的编号必须出自字典。
      const liveCodes = new Set(
        remote.map((r) => String((r as { sourceType: unknown }).sourceType ?? '').trim()).filter(Boolean),
      )
      const templateCodes = Object.values(TEMPLATE_TO_SNATCH)
        .map(parseCode)
        .filter((c): c is string => Boolean(c))
      const orphans = templateCodes.filter((c) => !liveCodes.has(c))
      if (orphans.length) {
        console.warn(
          '[dict] TEMPLATE_TO_SNATCH 映射到了后端字典外的编号: '
          + orphans.join(', ')
          + '\n  → configTypeFrom() 会写后端不识别的 configType',
        )
      }

      snatchTypes.value = formatted
      lastSyncAt.value = new Date().toISOString()
    } catch (e) {
      // 演示环境 / 后端不可达时静默回退到快照；保留 warn 便于排查
      console.warn('[dict] 加载抓取类型字典失败，保持本地快照:', (e as Error)?.message ?? e)
    } finally {
      loading.value = false
    }
  }

  return { snatchTypes, lastSyncAt, loading, loadSnatchTypes }
})
