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
import { ref, watch, type WatchStopHandle } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { firstUnboundDraftNodeId } from '@/utils/flow/stepPersist'
import { useStepWrite } from './useStepWrite'

export const FLOW_AUTOSAVE_MS = 800

export type FlowSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const status = ref<FlowSaveStatus>('idle')
const savedClock = ref('')
/** 最近一次自动保存失败的原因。头部小字的 title 展示它，排查时不用再去猜是哪一步抛的。 */
const lastError = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let stopWatch: WatchStopHandle | undefined
let stopSource: WatchStopHandle | undefined
let bindCount = 0
let pauseUntilRetry = false
let inFlight = false
let generation = 0

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

export function useFlowAutosave() {
  const flow = useFlowStore()
  const { persistFlowSteps } = useStepWrite()

  function schedule() {
    if (pauseUntilRetry || inFlight) return
    if (!flow.sourceCfg?.sourceId && !flow.sourceCtx?.sourceId) return
    clearTimer()
    timer = setTimeout(() => { void flush() }, FLOW_AUTOSAVE_MS)
  }

  async function flush() {
    clearTimer()
    const sourceId = flow.sourceCfg?.sourceId || flow.sourceCtx?.sourceId
    if (!sourceId) return
    if (inFlight) return
    if (firstUnboundDraftNodeId(flow.main, flow.configs)) {
      status.value = 'pending'
      return
    }
    pauseUntilRetry = false
    inFlight = true
    status.value = 'saving'
    const rev = flow.flowRev
    const gen = generation
    try {
      await persistFlowSteps()
      if (generation !== gen) return
      lastError.value = ''
      if (flow.flowRev !== rev) {
        inFlight = false
        schedule()
        return
      }
      flow.markFlowSaved()
      savedClock.value = clockNow()
      status.value = 'saved'
    } catch (e) {
      if (generation !== gen) return
      pauseUntilRetry = true
      status.value = 'error'
      // 原来这里是个连异常对象都不接的裸 catch：没有 toast、没有 console、没有上报，
      // 唯一痕迹是头部一行小字，而用户三秒前刚看到「已新建配置…并绑定到本节点」的绿色提示。
      // 更要命的是 pauseUntilRetry=true —— 自动保存**从此停摆**，之后改什么都不会保存。
      // 这是会丢数据的事，必须当场说出来，并且把原因留下来供排查。
      const detail = (e as Error)?.message || String(e)
      lastError.value = detail
      console.error('[flow-autosave] 步骤保存失败，自动保存已暂停', e)
      ElMessage.error(`流程节点未能保存：${detail}。自动保存已暂停，请点击头部「保存失败，点击重试」`)
    } finally {
      inFlight = false
    }
  }

  function bind() {
    bindCount += 1
    if (stopWatch) return
    stopWatch = watch(() => flow.flowRev, (rev) => {
      if (!rev) return
      pauseUntilRetry = false
      schedule()
    })
    stopSource = watch(
      () => flow.sourceCfg?.sourceId || flow.sourceCtx?.sourceId || '',
      () => {
        generation += 1
        clearTimer()
        pauseUntilRetry = false
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
    pauseUntilRetry = false
    inFlight = false
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
  pauseUntilRetry = false
  inFlight = false
  generation += 1
  if (timer !== undefined) {
    clearTimeout(timer)
    timer = undefined
  }
  status.value = 'idle'
  savedClock.value = ''
}
