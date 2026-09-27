// 流程步骤自动保存（0828 W9-2 / D06）：节点增删/移动/连线/换配置/进入条件后防抖 800ms 提交 item/next。
// 头部状态文案：请先保存节点配置 / 保存中… / 已保存 12:03 / 保存失败，点击重试。
// 只清 flowDirty，不清配置脏标（右侧「保存节点配置」仍独立）。
//
// ⚠️ **一个节点要落两次库，别只盯着一处**（2026-09-03 用户实测"节点显示保存成功，再进来就没了"）：
//   ① 右侧面板「保存」→ config/add，落的是**配置**（cs_config）
//   ② 这里的自动保存 → item/next/saveItemConfig，落的是**步骤**（cs_item_next）
// 重进画布时 buildSourceSeed 只认 sourceSteps 返回的步骤——**没有步骤行的节点等于不存在**。
// 所以节点能不能活下来全靠 ②，而 ① 已经先弹了一个绿色成功提示。
// ② 失败时必须叫出来，不能只在头部留一行小字：用户刚看过成功提示，不会再去读那行字。
//
// 0926 三处止血（对照「基础数据写正常」）：
//   a. **未绑定配置的草稿节点不再卡死整条自动保存**——flush 照常保存其它已绑定节点，
//      草稿节点留在画布上等右侧绑定（useStepWrite 内部跳过），头部仍提示「请先保存节点配置」。
//   b. **保存失败不再永久停摆**——改为退避自动重试（5s 起、指数增长、上限 60s），
//      下一次节点改动也会立刻重新尝试；错误 toast 每个失败段只弹一次。
//   c. **流程工作区（FlowDetailDrawer）同样自动保存步骤**——不依赖源上下文，
//      flow.flowIdMode 时按 flowId 锚定写（cs_item_config.FLOW_ID），与执行按流程反查对齐。
import { ref, watch, type WatchStopHandle } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { firstOutputTableMissingNodeId, firstUnboundDraftNodeId } from '@/utils/flow/stepPersist'
import { useStepWrite } from './useStepWrite'

export const FLOW_AUTOSAVE_MS = 800
export const FLOW_AUTOSAVE_RETRY_BASE_MS = 5000
export const FLOW_AUTOSAVE_RETRY_MAX_MS = 60000

export type FlowSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const status = ref<FlowSaveStatus>('idle')
const savedClock = ref('')
/** 最近一次自动保存失败的原因。头部小字的 title 展示它，排查时不用再去猜是哪一步抛的。 */
const lastError = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let stopWatch: WatchStopHandle | undefined
let stopSource: WatchStopHandle | undefined
let bindCount = 0
let inFlight = false
/** 在飞的那次 flush 的承诺：调用方（保存流程 / 关闭工作区）要等它落地时用。 */
let running: Promise<{ created: number; updated: number; skipped: number }> | undefined
let generation = 0
/** 连续失败次数，驱动退避；成功率 0 复位。 */
let failureCount = 0
/** 当前失败段是否已弹过 toast（每段只弹一次，避免永久失败时 800ms 一次刷屏）。 */
let errorNotified = false

function clockNow(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function clearTimer() {
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
}

function clearRetryTimer() {
  if (retryTimer !== undefined) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
}

export function useFlowAutosave() {
  const flow = useFlowStore()
  const sourceStore = useSourceStore()
  const { persistFlowSteps } = useStepWrite()

  function schedule() {
    if (inFlight) return
    // 源画布要源上下文；流程工作区按 flow.flowIdMode 走 flowId 锚定；两者皆无（裸画布）不写。
    if (!flow.sourceCfg?.sourceId && !flow.sourceCtx?.sourceId && !flow.flowIdMode) return
    // 新改动到来 = 新一轮尝试，打断旧的退避计时（失败后立刻重试，不用等退避到期）。
    clearRetryTimer()
    clearTimer()
    timer = setTimeout(() => { void flush() }, FLOW_AUTOSAVE_MS)
  }

  /** 失败退避：5s → 10s → 20s → 40s → 60s 封顶，持续失败时低频重试保底。 */
  function scheduleRetry() {
    if (bindCount <= 0) return
    // 注意：这里在 flush 的 catch 里被调用时 inFlight 仍为 true，不能拿它当守卫；
    // 计时器到点后 flush() 自己会处理在飞请求（等待或直接跑）。
    clearRetryTimer()
    const stepMs = FLOW_AUTOSAVE_RETRY_BASE_MS * 2 ** Math.min(Math.max(failureCount - 1, 0), 4)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void flush()
    }, Math.min(stepMs, FLOW_AUTOSAVE_RETRY_MAX_MS))
  }

  async function flush(): Promise<void> {
    // 撞上在飞请求（保存流程 / 关闭工作区等调用方）：等在飞那轮落地；若等待期间又有新改动
    // （flowRev 变，新一轮防抖已排上 800ms），这里**不等防抖、直接续跑一轮**——调用方要的
    // 是"此刻的改动已落库"，不能在飞一结束就假装完成（0926 REVIEW F-R4）。
    let waited = 0
    while (inFlight && waited < 3) {
      const revAtWait = flow.flowRev
      await running
      waited += 1
      if (flow.flowRev === revAtWait) return
    }
    if (inFlight) return
    const sourceId = flow.sourceCfg?.sourceId || flow.sourceCtx?.sourceId
    if (!sourceId && !flow.flowIdMode) return
    clearRetryTimer()
    // 立即落库：把挂起的防抖计时也消掉，免得稍后又跑一遍重复写同一批值
    clearTimer()
    // 有未绑定配置或输出表未就绪（0927 H1）的节点时：照常保存其它节点，但成功后状态留在
    // pending（头部「请先补全节点配置」依然准确）；不阻断、不假装全部完成。
    const hasIncomplete = firstUnboundDraftNodeId(flow.main, flow.configs) !== undefined
      || firstOutputTableMissingNodeId(flow.main, flow.branchGroups, flow.configs, sourceStore.stepSnapshots) !== undefined
    inFlight = true
    status.value = 'saving'
    const rev = flow.flowRev
    const gen = generation
    running = persistFlowSteps()
    try {
      await running
      if (generation !== gen) {
        // 现场已切换（切源 / 切流程）：作废这次结果。新画布载入（loadIntoWorkspace /
        // deriveFromFlowConfig / loadFromSource）都会对新现场 markSaved，没有"待保存改动"；
        // 状态回 idle，避免头部永远停在「保存中…」等下一次改动来覆盖。
        if (status.value === 'saving') status.value = 'idle'
        return
      }
      failureCount = 0
      errorNotified = false
      lastError.value = ''
      if (flow.flowRev !== rev) {
        // 保存期间又有改动：不等下一轮 debounce，立刻再排一次。
        inFlight = false
        schedule()
        return
      }
      flow.markFlowSaved()
      savedClock.value = clockNow()
      // 0927 P1-5：跳过回写的节点（flowIdMode 下无步骤快照的 R2 遗留形态，常见于快照拉取
      // 失败降级为 []）同样把状态留在 pending——不再假装「已保存」（此前静默跳过，用户
      // 看到已保存、实际一行未写）。
      const settled = await running
      status.value = (hasIncomplete || (settled?.skipped ?? 0) > 0) ? 'pending' : 'saved'
    } catch (e) {
      if (generation !== gen) {
        // 失败的同时现场已切换：也不留 error 状态（那是旧现场的错）
        if (status.value === 'saving') status.value = 'idle'
        return
      }
      failureCount += 1
      status.value = 'error'
      // 原来这里是个连异常对象都不接的裸 catch：没有 toast、没有 console、没有上报，
      // 唯一痕迹是头部一行小字，而用户三秒前刚看到「已新建配置…并绑定到本节点」的绿色提示。
      // 更要命的是原来失败后自动保存**从此停摆**——改什么都不会保存（0926 已改为退避重试）。
      const detail = (e as Error)?.message || String(e)
      lastError.value = detail
      console.error('[flow-autosave] 步骤保存失败，将自动重试', e)
      if (!errorNotified) {
        errorNotified = true
        ElMessage.error(`流程节点未能保存：${detail}。将自动重试，也可点击头部「保存失败，点击重试」立即重试`)
      }
      scheduleRetry()
    } finally {
      inFlight = false
      running = undefined
    }
  }

  function bind() {
    bindCount += 1
    if (stopWatch) return
    stopWatch = watch(() => flow.flowRev, (rev) => {
      if (!rev) return
      schedule()
    })
    stopSource = watch(
      // 源上下文 / 工作区形态 / 流程 ID 任一变化都视为"换了现场"：作废在飞结果、清旧状态。
      // （0926 REVIEW F-R3：drawer 里从流程 A 切到流程 B 时 sourceId 恒空、flowIdMode 恒 true，
      //  只有 flow.flowId 会变——原先漏了它，切换瞬间在飞的保存仍会按旧现场继续跑）
      () => [flow.sourceCfg?.sourceId || flow.sourceCtx?.sourceId || '', flow.flowIdMode, flow.flowId] as const,
      () => {
        generation += 1
        clearTimer()
        clearRetryTimer()
        failureCount = 0
        if (status.value !== 'saving') {
          status.value = 'idle'
          savedClock.value = ''
        }
      },
    )
  }

  function unbind() {
    bindCount = Math.max(0, bindCount - 1)
    if (bindCount > 0) return
    stopWatch?.()
    stopWatch = undefined
    stopSource?.()
    stopSource = undefined
    clearTimer()
    clearRetryTimer()
    inFlight = false
    running = undefined
    failureCount = 0
    errorNotified = false
    generation += 1
    status.value = 'idle'
    savedClock.value = ''
  }

  return { status, savedClock, lastError, flush, bind, unbind }
}

/** 测试用：拆掉单例 watcher / 计时器。 */
export function resetFlowAutosaveForTests() {
  stopWatch?.()
  stopWatch = undefined
  stopSource?.()
  stopSource = undefined
  bindCount = 0
  inFlight = false
  running = undefined
  failureCount = 0
  errorNotified = false
  generation += 1
  clearTimer()
  clearRetryTimer()
  status.value = 'idle'
  savedClock.value = ''
}