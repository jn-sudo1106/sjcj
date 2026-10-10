/**
 * 流程版本（2026-10-10）：217 后端 10-10 13:10 起全部流程进版本模式——每个流程有一条已发布的 v1，
 * **发布版只读**，直接改步骤一律被拒「请先进入流程草稿编辑并重新加载版本信息」（画布删节点就是这样报的）。
 *
 * 口径对齐 217 旧平台（`旧平台代码/data-view-feature-2606-rule-vue2` FlowNodeDrawer / SourceStep）：
 *   - 改步骤只能写在草稿里，增 / 改 / 删 / 启停都带 flowId + versionId + ver；
 *   - ver 是**版本行**的乐观锁计数，每写一次 +1，响应不回新值 → 每次写完重读 overview；
 *   - 草稿里步骤 itemConfig 与发布版相同，画布不用换 ID。
 *
 * 进入草稿与旧平台一致（用户 2026-10-10 定，第一版做成「首次写入自动建草稿」后改回）：
 * 发布版 / 锁定的草稿**只读**（画布与检查器都不能改），点版本条「编辑草稿」从发布版生成草稿 Vn+1 后才能改；
 * 改完点「发布」变成发布 Vn+1。锁定草稿、手工运行草稿、切换发布版本、归档本期不做（旧平台可用）。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { flowVersionApi, type FlowVersionOverview, type FlowVersionRef, type FlowVersionRow } from '@/api'
import { validFlowIdOf } from '@/utils/flow/stepPersist'

/** 画布当前流程 ID（与 useStepWrite.flowIdOf 同口径）：流程工作区取 flowId，源画布取源绑定的流程 */
export function canvasFlowIdOf(flow: { flowIdMode: boolean; flowId: string; sourceCfg?: { flowId?: string } | null; sourceCtx?: { flowId?: string } | null }): string {
  return flow.flowIdMode
    ? validFlowIdOf(flow.flowId)
    : validFlowIdOf(flow.sourceCfg?.flowId) || validFlowIdOf(flow.sourceCtx?.flowId)
}

export const useFlowVersionStore = defineStore('flowVersion', () => {
  /** 画布当前展示的流程（顶部版本条、读哪个版本的步骤都按它） */
  const flowId = ref('')
  /** 按流程 ID 缓存的版本概览：复制配置等会写别的流程，不能为此把画布的版本状态切走 */
  const overviews = ref<Record<string, FlowVersionOverview | null>>({})

  const rowOf = (ov: FlowVersionOverview | null | undefined, id: string | null | undefined): FlowVersionRow | undefined =>
    ov && id ? ov.versions.find((v) => v.versionId === id) : undefined
  /** 可编辑的草稿（state=W、未放弃） */
  const draftOf = (ov: FlowVersionOverview | null | undefined): FlowVersionRow | undefined => {
    const row = rowOf(ov, ov?.draftId)
    return row && row.state === 'W' && row.isDelete === 0 ? row : undefined
  }

  const overview = computed(() => overviews.value[flowId.value] ?? null)
  const enabled = computed(() => !!overview.value?.enabled)
  const published = computed(() => rowOf(overview.value, overview.value?.publishId))
  const draft = computed(() => draftOf(overview.value))
  /** 画布该读哪个版本的步骤：有草稿读草稿，否则 null（读运行中的发布版，接口不带 versionId） */
  const viewVersionId = computed(() => (enabled.value && draft.value ? draft.value.versionId : null))
  /** 当前流程只读：启用了版本，且没有草稿或草稿已锁定（旧平台 editingDraft 的反面） */
  const readonly = computed(() => enabled.value && (!draft.value || draft.value.isLock === 1))

  async function fetchOverview(id: string): Promise<FlowVersionOverview> {
    const data = await flowVersionApi.overview(id)
    overviews.value = { ...overviews.value, [id]: data }
    return data
  }

  /** 画布切到某个流程：读版本概览。读失败按未启用处理（写入不带版本信息，后端拒绝时会照常报错）。 */
  async function load(id: string): Promise<void> {
    flowId.value = id
    if (!id) return
    try {
      await fetchOverview(id)
    } catch {
      overviews.value = { ...overviews.value, [id]: null }
    }
  }

  async function refresh(id: string = flowId.value): Promise<void> {
    if (id) await fetchOverview(id)
  }

  /** 写入前：未启用版本 → null（照旧写）；有可编辑草稿 → 返回写入引用；否则拒绝（发布版只读）。
   *  画布在只读态已禁止操作，这里是兜底——任何写入路径漏网也不会去碰发布版。 */
  async function ensureDraftRef(id: string): Promise<FlowVersionRef | null> {
    let ov = overviews.value[id]
    if (ov === undefined) ov = await fetchOverview(id).catch(() => null)
    if (!ov?.enabled) return null
    const d = draftOf(ov)
    if (!d) throw new Error(`当前是已发布版本 V${ov.curVer ?? '—'}，只读；请先点「编辑草稿」再修改`)
    if (d.isLock === 1) throw new Error(`草稿 V${d.flowVer} 已锁定，解锁后才能修改`)
    return { flowId: id, versionId: d.versionId, ver: d.ver }
  }

  /** 编辑草稿：从当前发布版生成草稿 Vn+1（旧平台「编辑草稿」按钮）。已有草稿时什么都不做。 */
  async function createDraft(): Promise<void> {
    const id = flowId.value
    const ov = overview.value
    if (!id || !ov?.enabled || draft.value) return
    const pub = published.value
    if (!pub) throw new Error('该流程没有发布版本，无法生成草稿，请刷新后重试')
    await flowVersionApi.action('draft', { flowId: id, versionId: pub.versionId, ver: pub.ver, expectedPublishId: ov.publishId })
    await fetchOverview(id)
  }

  // 写入串行：ver 是整版一个计数，两次写并发会拿到同一个 ver，后一个必被「内容已变更」拒绝
  let queue: Promise<unknown> = Promise.resolve()

  /**
   * 带版本信息写步骤：串行执行，写前确认在可编辑的草稿里，写后重读 ver。
   * 流程 ID 为空（裸画布 / 无流程的源）或流程未启用版本时，fn 收到 null，照旧写。
   */
  function withDraft<T>(id: string, fn: (ref: FlowVersionRef | null) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const ref = id ? await ensureDraftRef(id) : null
      try {
        return await fn(ref)
      } finally {
        // 成功 ver +1；失败也重读——后端可能已动过版本行，留着旧 ver 下一次必冲突
        if (ref) await fetchOverview(id).catch(() => undefined)
      }
    }
    const next = queue.then(run, run)
    queue = next.catch(() => undefined)
    return next
  }

  async function act(action: 'publish' | 'abandon') {
    const id = flowId.value
    const d = draft.value
    if (!d || !id) throw new Error(action === 'publish' ? '当前没有可发布的草稿' : '当前没有草稿')
    await flowVersionApi.action(action, { flowId: id, versionId: d.versionId, ver: d.ver, expectedPublishId: overview.value?.publishId ?? null })
    await fetchOverview(id)
  }

  /** 发布当前草稿：新任务用草稿版本，已启动的任务继续用原版本 */
  const publish = () => act('publish')
  /** 放弃当前草稿（不占发布版本号）；画布由调用方按发布版重新加载 */
  const abandon = () => act('abandon')

  function reset() {
    flowId.value = ''
  }

  return { flowId, overview, enabled, published, draft, viewVersionId, readonly, load, refresh, ensureDraftRef, withDraft, createDraft, publish, abandon, reset }
})
