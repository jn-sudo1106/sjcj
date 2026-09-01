// 流程步骤自动保存（0828 W9-2 / D06）：节点增删/移动/连线/换配置/进入条件后防抖 800ms 提交 item/next。
// 头部状态文案：保存中… / 已保存 12:03 / 保存失败，点击重试。
// 只清 flowDirty，不清配置脏标（右侧「保存节点配置」仍独立）。
import { ref, watch, type WatchStopHandle } from 'vue'
import { useFlowStore } from '@/stores/flow'
import { useStepWrite } from './useStepWrite'

export const FLOW_AUTOSAVE_MS = 800

export type FlowSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const status = ref<FlowSaveStatus>('idle')
const savedClock = ref('')
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
    pauseUntilRetry = false
    inFlight = true
    status.value = 'saving'
    const rev = flow.flowRev
    const gen = generation
    try {
      await persistFlowSteps()
      if (generation !== gen) return
      if (flow.flowRev !== rev) {
        inFlight = false
        schedule()
        return
      }
      flow.markFlowSaved()
      savedClock.value = clockNow()
      status.value = 'saved'
    } catch {
      if (generation !== gen) return
      pauseUntilRetry = true
      status.value = 'error'
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

  return { status, savedClock, flush, bind, unbind }
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
