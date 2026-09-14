import { sourceApi, type Step } from '@/api'

export interface ResolvedNextStepConfig {
  /** 是否存在后续步骤节点 */
  hasNext: boolean
  /** 后续步骤节点是否全部被停用 */
  allDisabled?: boolean
  /** 停用的后续步骤名称列表 */
  disabledTitles: string[]
  /** 首选的直接后继步骤配置 */
  nextStep?: Step
  /** 所有直接后继步骤配置（多分支时） */
  nextSteps: Step[]
  /** 后续节点输入表 ID（用于发送任务的 entryTypeId） */
  targetTableId?: string
  /** 后续节点的配置 ID（configId） */
  targetConfigId?: string
  /** 后续节点步骤 ID（itemConfig / stepId） */
  targetStepId?: string
  /** 后续节点显示名称 */
  targetNodeName: string
  /** 多分支分流说明 */
  branchHint?: string
  /** 未能发后续的原因（若无后继） */
  reason?: string
}

export interface CurrentNodeConfigHint {
  configId?: string
  stepId?: string
  title?: string
  queue?: string
}

/**
 * 根据 item/next/nextConfigPaged 返回的步骤列表与当前选中的节点 ID，
 * 精准定位流程的下一个节点配置（Next Step Config）。
 *
 * 对齐用户要求：
 * 选择某个节点发后续任务，必须根据当前节点请求流程的下一个节点配置（nextConfigPaged）去发任务，
 * 提取下一个节点的真实配置参数（如输入表 entryTypeId / configId），而不是发当前节点自身。
 */
export function resolveNextStepConfigFromSteps(
  steps: Step[],
  currentNodeId: string,
  currentConfig?: CurrentNodeConfigHint,
): ResolvedNextStepConfig {
  if (!steps || steps.length === 0) {
    return {
      hasNext: false,
      disabledTitles: [],
      nextSteps: [],
      targetNodeName: '',
      reason: '当前源未配置任何步骤节点',
    }
  }

  const curIdStr = String(currentNodeId ?? '').trim()

  // 1. 判断是否为起点节点：
  // currentNodeId 为空、'0'、'start'、以 'source:' 开头，
  // 或是 steps 中的显式 root 步骤（isRoot=true 或 stepId='0'）
  const isExplicitRoot =
    !curIdStr ||
    curIdStr === '0' ||
    curIdStr === 'start' ||
    curIdStr.startsWith('source:')

  // 2. 查找当前节点对应的步骤（按 stepId 或 configId 匹配，未匹配时按 currentConfig 线索兜底）
  let currentStep = steps.find(
    (s) => String(s.stepId) === curIdStr || (s.configId && String(s.configId) === curIdStr),
  )

  if (!currentStep && currentConfig) {
    const hintStepId = currentConfig.stepId ? String(currentConfig.stepId).trim() : ''
    const hintConfigId = currentConfig.configId ? String(currentConfig.configId).trim() : ''
    const hintQueue = currentConfig.queue ? String(currentConfig.queue).trim() : ''
    const hintTitle = currentConfig.title ? String(currentConfig.title).trim() : ''

    currentStep = steps.find((s) => {
      if (hintStepId && String(s.stepId) === hintStepId) return true
      if (hintConfigId && s.configId && String(s.configId) === hintConfigId) return true
      if (hintQueue && s.topic && s.topic === hintQueue) return true
      if (hintTitle && s.name && s.name === hintTitle) return true
      return false
    })
  }

  const isRootNode = isExplicitRoot || Boolean(currentStep && (currentStep.isRoot || currentStep.stepId === '0'))

  let directSuccessors: Step[] = []

  if (isRootNode) {
    // 起点节点的后继：寻找 dependsOn 包含 '0' 或 'start' 的步骤
    directSuccessors = steps.filter((s) => {
      if (s.stepId === '0' || s.isRoot) return false
      if (s.dependsOn?.includes('0') || s.dependsOn?.includes('start')) return true
      return false
    })
    // 兜底：如果都没有显式 lastStep=0，取第一个非零子步骤
    if (directSuccessors.length === 0) {
      const nonRoots = steps.filter((s) => s.stepId !== '0' && !s.isRoot)
      if (nonRoots.length > 0) directSuccessors = [nonRoots[0]]
    }
  } else if (currentStep) {
    const curStepId = String(currentStep.stepId)
    // 具体步骤节点的后继：寻找 lastStep (dependsOn) 指向当前 stepId 的步骤
    directSuccessors = steps.filter((s) => {
      if (String(s.stepId) === curStepId) return false
      return Boolean(s.dependsOn && s.dependsOn.includes(curStepId))
    })

    // 兜底：如果步骤未配置 dependsOn（线性旧步骤），按列表顺序取紧跟在当前步骤后面的一个
    if (directSuccessors.length === 0) {
      const idx = steps.findIndex((s) => String(s.stepId) === curStepId)
      if (idx >= 0 && idx + 1 < steps.length) {
        directSuccessors = [steps[idx + 1]]
      }
    }
  } else {
    // currentStep 没精确命中，按 dependsOn 寻找
    directSuccessors = steps.filter((s) => s.dependsOn?.includes(curIdStr))
  }

  if (directSuccessors.length === 0) {
    return {
      hasNext: false,
      disabledTitles: [],
      nextSteps: [],
      targetNodeName: '',
      reason: '当前节点在流程中没有后续节点配置，无法发后续任务',
    }
  }

  // 区分启用与停用的后继节点
  const enabledSuccessors = directSuccessors.filter((s) => s.enabled !== false)
  const disabledSuccessors = directSuccessors.filter((s) => s.enabled === false)
  const disabledTitles = disabledSuccessors.map((s) => s.name || s.stepId)

  if (enabledSuccessors.length === 0) {
    return {
      hasNext: false,
      allDisabled: true,
      disabledTitles,
      nextSteps: directSuccessors,
      targetNodeName: directSuccessors.map((s) => s.name || s.stepId).join('、'),
      reason: `后续节点（${disabledTitles.join('、')}）已停用，无法发起后续任务`,
    }
  }

  const primaryNext = enabledSuccessors[0]
  // 提取下一个节点的输入表：必须使用该后继步骤配置的输入表（inputTable 对应 entryTypeId）
  const targetTableId = primaryNext.inputTable || primaryNext.outputTable || ''
  const targetConfigId = primaryNext.configId
  const targetStepId = primaryNext.stepId
  const targetNodeName = enabledSuccessors.map((s) => s.name || s.stepId).join('、')

  let branchHint = ''
  if (enabledSuccessors.length > 1) {
    branchHint = enabledSuccessors
      .map((s) => `${s.name || s.stepId}${s.condition ? `（${s.condition}）` : '（无条件）'}`)
      .join('、')
  }

  return {
    hasNext: true,
    disabledTitles,
    nextStep: primaryNext,
    nextSteps: enabledSuccessors,
    targetTableId,
    targetConfigId,
    targetStepId,
    targetNodeName,
    branchHint,
  }
}

/**
 * 根据当前源 ID 实时拉取 item/next/nextConfigPaged 步骤配置，
 * 并解析当前选定节点的下一个节点配置。
 */
export async function fetchNextStepConfig(
  sourceId: string,
  currentNodeId: string,
  fallbackSteps?: Step[],
  currentConfig?: CurrentNodeConfigHint,
): Promise<ResolvedNextStepConfig> {
  let steps: Step[] = []

  const isTest = import.meta.env.MODE === 'test'
  const isMocked = Boolean((sourceApi.sourceSteps as any)?.mock)

  // 1. 真实运行环境（或单测显式 mock 了 sourceSteps 时）：严格请求 item/next/nextConfigPaged?sourceId=${sourceId}&svg=true
  if (!isTest || isMocked) {
    try {
      const fetched = await sourceApi.sourceSteps(sourceId, { withConfigDetails: false })
      if (fetched && fetched.length > 0) {
        steps = fetched
      }
    } catch {
      // ignore network error
    }
  }

  // 2. 若接口请求失败或为空，回退到 sourceStore 快照（注意子步骤 sourceId 为 -1，只要存在快照即使用）
  if (steps.length === 0) {
    try {
      const { useSourceStore } = await import('@/stores/source')
      const store = useSourceStore()
      const cached = Object.values(store.stepSnapshots || {})
      if (cached.length > 0) {
        steps = cached
      }
    } catch {
      // ignore
    }
  }

  // 3. 兜底回退到外部传入的步骤列表（如画布已有的 flowSteps）
  if ((!steps || steps.length === 0) && fallbackSteps && fallbackSteps.length > 0) {
    steps = fallbackSteps
  }

  return resolveNextStepConfigFromSteps(steps, currentNodeId, currentConfig)
}
