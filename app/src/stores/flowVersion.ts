/**
 * 流程版本（2026-10-10）：217 后端 10-10 13:10 起全部流程进版本模式——每个流程有一条已发布的 v1，
 * **发布版只读**，直接改步骤一律被拒「请先进入流程草稿编辑并重新加载版本信息」（画布删节点就是这样报的）。
 *
 * 口径对齐 217 旧平台（`旧平台代码/data-view-feature-2606-rule-vue2` FlowNodeDrawer / SourceStep）：
 *   - 改步骤只能写在草稿里，增 / 改 / 删 / 启停都带 flowId + versionId + ver；
 *   - ver 是**版本行**的乐观锁计数，每写一次 +1，响应不回新值 → 每次写完重读 overview；
 *   - 草稿里步骤 itemConfig 与发布版相同，画布不用换 ID。
 *
 * 进入草稿（2026-10-11 定，与旧平台不同）：**不用先点「编辑草稿」**——在发布版上直接改，第一次真实写入时
 * 自动从发布版生成草稿 Vn+1，之后一直是这个草稿，直到「发布」或「放弃草稿」。产品原话：「拉一个节点就自动是
 * 草稿，只要不发布就一直是这个版本的草稿态，不然每次多点一下；这是前端设计，和接口无关」。
 * （10-10 曾按旧平台改成「先点编辑草稿、发布版只读」，10-11 改回自动。）只是打开查看不会生成草稿：
 * 自动保存对无改动步骤不回写（useStepWrite.persistExisting）。
 * 只读只剩「草稿已锁定」（锁定 / 解锁在旧平台做）。手工运行草稿、切换发布版本、归档本期不做。
 *
 * 查看历史版本（2026-10-14，设计稿/设计方案/1014-流程历史版本查看_开发设计方案）：流程中心抽屉里选一个
 * 历史版本（旧发布版 / 已放弃草稿）后 historyVersionId 有值，画布按它读步骤并整体只读；任何写入都拒绝，
 * 不会顺手生成草稿。只做查看，不做切换发布版本。
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
  /** 正在查看的历史版本（只属于 flowId 这个流程）；null = 正常编辑 */
  const historyVersionId = ref<string | null>(null)

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
  /** 正在查看的历史版本行 */
  const history = computed(() => (enabled.value ? rowOf(overview.value, historyVersionId.value) : undefined))
  /** 正常编辑时画布展示的版本：有草稿是草稿，否则是运行中的发布版 */
  const currentVersionId = computed(() => draft.value?.versionId ?? overview.value?.publishId ?? null)
  /** 画布该读哪个版本的步骤：查看历史读历史；有草稿读草稿；否则 null（读运行中的发布版，接口不带 versionId） */
  const viewVersionId = computed(() => history.value?.versionId ?? (enabled.value && draft.value ? draft.value.versionId : null))
  /** 当前流程只读：查看历史版本，或草稿已锁定（发布版可直接改，首次写入自动生成草稿） */
  const readonly = computed(() => !!history.value || (enabled.value && draft.value?.isLock === 1))

  async function fetchOverview(id: string): Promise<FlowVersionOverview> {
    const data = await flowVersionApi.overview(id)
    overviews.value = { ...overviews.value, [id]: data }
    return data
  }

  /** 画布切到某个流程：读版本概览。读失败按未启用处理（写入不带版本信息，后端拒绝时会照常报错）。 */
  async function load(id: string): Promise<void> {
    if (id !== flowId.value) historyVersionId.value = null
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

  /** 写入前：未启用版本 → null（照旧写）；没有草稿 → 从发布版自动生成草稿；返回写入引用。锁定的草稿拒绝。 */
  async function ensureDraftRef(id: string): Promise<FlowVersionRef | null> {
    if (historyVersionId.value && id === flowId.value) throw new Error('正在查看历史版本，只能查看不能修改，请先返回当前版本')
    let ov = overviews.value[id]
    if (ov === undefined) ov = await fetchOverview(id).catch(() => null)
    if (!ov?.enabled) return null
    if (!draftOf(ov)) {
      const pub = rowOf(ov, ov.publishId)
      if (!pub) throw new Error('该流程没有发布版本，无法生成草稿，请刷新后重试')
      await flowVersionApi.action('draft', { flowId: id, versionId: pub.versionId, ver: pub.ver, expectedPublishId: ov.publishId })
      ov = await fetchOverview(id)
    }
    const d = draftOf(ov)
    if (!d) throw new Error('生成草稿失败，请刷新后重试')
    if (d.isLock === 1) throw new Error(`草稿 V${d.flowVer} 已锁定，解锁后才能修改`)
    return { flowId: id, versionId: d.versionId, ver: d.ver }
  }

  // 写入串行：ver 是整版一个计数，两次写并发会拿到同一个 ver，后一个必被「内容已变更」拒绝
  let queue: Promise<unknown> = Promise.resolve()

  /**
   * 带版本信息写步骤：串行执行，写前确保有草稿（没有就自动生成），写后重读 ver。
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
    if (history.value) throw new Error('正在查看历史版本，请先返回当前版本')
    await flowVersionApi.action(action, { flowId: id, versionId: d.versionId, ver: d.ver, expectedPublishId: overview.value?.publishId ?? null })
    await fetchOverview(id)
  }

  /** 发布当前草稿：新任务用草稿版本，已启动的任务继续用原版本 */
  const publish = () => act('publish')
  /** 放弃当前草稿（不占发布版本号）；画布由调用方按发布版重新加载 */
  const abandon = () => act('abandon')

  /** 查看某个版本：选的就是当前版本（草稿，或没有草稿时的运行版）等于回到正常编辑 */
  function viewHistory(versionId: string | null) {
    historyVersionId.value = versionId && versionId !== currentVersionId.value ? versionId : null
  }
  const exitHistory = () => viewHistory(null)

  function reset() {
    flowId.value = ''
    historyVersionId.value = null
  }

  return {
    flowId, overview, enabled, published, draft, history, currentVersionId, viewVersionId, readonly,
    load, refresh, ensureDraftRef, withDraft, publish, abandon, viewHistory, exitHistory, reset,
  }
})
