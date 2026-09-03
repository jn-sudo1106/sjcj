// 步骤写接口联调（2026-08-31）：节点名 / 进入条件 / 增删节点走 item/next，不走配置。
//
// 改已有步骤必须带加载时的 Step 快照（url / itemId / lastStep / mainConfig），
// 只改名称也会整包提交——缺字段会被后端写成 null。
// 新建步骤响应不回 itemConfig，要再查 nextConfigPaged 用差集定位，并 enable?state=0
// （新建默认停用）。虚拟起点 itemConfig=0 和本地草稿 id 不写。
import { ElMessage, ElMessageBox } from 'element-plus'
import { itemApi, sourceApi, type Ack, type Step } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import {
  assertStepsPersistable,
  isWritableStepId,
  hasRealBranches,
  lastStepIdsFromCanvas,
  mergeStepForWrite,
} from '@/utils/flow/stepPersist'

function assertOk(ack: Ack | null | undefined, fallback: string) {
  if (ack && 'ok' in ack && ack.ok === false) throw new Error(ack.message || fallback)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function createTemplateFromPrev(prev: Step | undefined, sourceId: string, configId: string): Pick<Step, 'sourceId' | 'mainConfig' | 'url' | 'itemId' | 'flowCode' | 'nodeType'> {
  return {
    sourceId: prev?.sourceId ?? sourceId,
    mainConfig: prev?.mainConfig ?? configId,
    url: prev ? (prev.url ?? '$VAL$') : undefined,
    itemId: prev?.itemId,
    flowCode: prev?.flowCode,
    nodeType: prev?.nodeType ?? 'entry',
  }
}

export function useStepWrite() {
  const flow = useFlowStore()
  const sourceStore = useSourceStore()

  function sourceIdOf(): string {
    return flow.sourceCfg?.sourceId || flow.sourceCtx?.sourceId || ''
  }

  async function persistExisting(nodeId: string, lastStepFromCanvas: boolean) {
    const snapshot = sourceStore.stepSnapshots[nodeId]
    if (!snapshot) {
      throw new Error(`节点 ${nodeId} 没有步骤快照，已跳过写入以免覆盖后端字段`)
    }
    const cfg = flow.configs[nodeId]
    if (!cfg) throw new Error(`节点 ${nodeId} 不存在`)
    const step = mergeStepForWrite({
      snapshot,
      cfg,
      nodeId,
      sourceId: sourceIdOf() || snapshot.sourceId,
      lastStepIds: lastStepFromCanvas ? lastStepIdsFromCanvas(flow.main, nodeId) : undefined,
    })
    const ack = await itemApi.stepModify(step)
    assertOk(ack, '修改步骤失败')
    sourceStore.rememberSteps([step], 'merge')
  }

  async function createAndLocate(nodeId: string): Promise<string> {
    const cfg = flow.configs[nodeId]
    if (!cfg?.configId) throw new Error(`节点「${cfg?.title || nodeId}」尚未绑定配置，无法新建步骤`)
    const sid = sourceIdOf()
    if (!sid) throw new Error('当前没有可保存的源')
    const lastStepIds = lastStepIdsFromCanvas(flow.main, nodeId)
    const prevId = lastStepIds[0] !== '0' ? lastStepIds[0] : undefined
    const prev = prevId ? sourceStore.stepSnapshots[prevId] : undefined
    const inherited = createTemplateFromPrev(prev, sid, cfg.configId)
    const step = mergeStepForWrite({
      snapshot: {
        ...inherited,
        stepId: '',
        name: cfg.title.trim(),
        enabled: !cfg.disabled,
      },
      cfg,
      nodeId,
      sourceId: inherited.sourceId,
      lastStepIds,
    })
    const before = new Set([
      ...Object.keys(sourceStore.stepSnapshots),
      ...flow.main.filter(isWritableStepId),
    ])
    const ack = await itemApi.saveItemConfig(step)
    assertOk(ack, '新增步骤失败')
    const steps = await sourceApi.sourceSteps(sid, { withConfigDetails: false })
    const added = steps.filter((s) => isWritableStepId(s.stepId) && !before.has(s.stepId))
    const wanted = cfg.title.trim()
    const matched = added.length === 1
      ? added
      : added.filter((s) => s.name === wanted)
    if (matched.length !== 1) {
      throw new Error(`新建步骤后无法唯一定位（匹配到 ${matched.length} 条），请刷新画布确认`)
    }
    const created = matched[0]
    sourceStore.rememberSteps([created], 'merge')
    try {
      const enableAck = await itemApi.enable(created.stepId, '0')
      assertOk(enableAck, '启用新步骤失败')
      sourceStore.rememberSteps([{ ...created, enabled: true }], 'merge')
    } catch (e) {
      ElMessage.warning(`步骤已创建（#${created.stepId}），但启用失败：${errorMessage(e)}`)
    }
    if (!flow.rebindNodeId(nodeId, created.stepId)) {
      throw new Error(`步骤已创建（#${created.stepId}），但画布节点未能换成新 ID`)
    }
    return created.stepId
  }

  /** 编辑节点名称弹窗：已落库步骤立刻 stepModify；本地草稿只改画布，绑定配置后由自动保存落库。 */
  async function persistNodeName(nodeId: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('节点名称不能为空')
    if (!isWritableStepId(nodeId)) {
      flow.setTitle(nodeId, trimmed)
      ElMessage.success(nodeId === '0'
        ? '已更新画布名称（虚拟起点不能写入步骤接口）'
        : '已更新节点名称（未绑定配置，绑定后自动落库）')
      return
    }
    if (trimmed === (flow.configs[nodeId]?.title ?? '')) {
      ElMessage.success('节点名称已保存')
      return
    }
    if (!sourceStore.stepSnapshots[nodeId]) {
      flow.setTitle(nodeId, trimmed)
      ElMessage.warning('已改画布名称，但缺少步骤快照，请刷新源后再保存，避免覆盖后端字段')
      return
    }
    const prev = flow.configs[nodeId]?.title ?? ''
    flow.setTitle(nodeId, trimmed)
    try {
      await persistExisting(nodeId, false)
    } catch (e) {
      flow.setTitle(nodeId, prev)
      throw e
    }
    ElMessage.success('节点名称已保存')
  }

  /**
   * 自动保存：先新建缺 ID 的节点，再按画布回写已有步骤的名称/条件/lastStep。
   *
   * ⚠️ **有真实分支的流程不重算 `lastStep`**（0903 YB-A 止血）。`buildSourceSeed` 目前把
   * 子步骤一律拍成一条主链，分支流程在画布上是**假的直线**；据此重算前置会把
   * 「40620 挂在 40597 下」改写成「挂在 40598 后面」，分支被静默拍平且不可逆。
   * 名称、进入条件这些与拓扑无关的字段照常写。分支拓扑还原见 YB-B。
   */
  async function persistFlowSteps(): Promise<{ created: number; updated: number }> {
    const sid = sourceIdOf()
    if (!sid) return { created: 0, updated: 0 }
    assertStepsPersistable(flow.main, flow.configs)
    const branched = hasRealBranches(sourceStore.stepSnapshots)
    let created = 0
    let updated = 0

    for (const id of [...flow.main]) {
      if (id === 'start' || id === 'end' || id === '0' || isWritableStepId(id)) continue
      const cfg = flow.configs[id]
      if (!cfg) continue
      await createAndLocate(id)
      created += 1
    }

    for (const id of flow.main) {
      if (!isWritableStepId(id) || !flow.configs[id]) continue
      if (!sourceStore.stepSnapshots[id]) {
        throw new Error(`节点「${flow.configs[id].title || id}」缺少步骤快照，请刷新源后再保存`)
      }
      await persistExisting(id, !branched)
      updated += 1
    }

    return { created, updated }
  }

  async function deleteCanvasNode(nodeId: string, opts?: { confirmed?: boolean }): Promise<boolean> {
    if (!nodeId || nodeId === 'start' || nodeId === 'end') return false
    if (!opts?.confirmed) {
      try {
        await ElMessageBox.confirm('删除后不可恢复。确定删除该节点？', '删除节点', {
          type: 'warning',
          confirmButtonText: '删除',
          cancelButtonText: '取消',
        })
      } catch {
        return false
      }
    }
    try {
      if (isWritableStepId(nodeId)) {
        const ack = await itemApi.deleteStep(nodeId)
        assertOk(ack, '删除步骤失败')
        sourceStore.forgetStep(nodeId)
      }
      flow.remove(nodeId)
      ElMessage.success('节点已删除')
      return true
    } catch (e) {
      ElMessage.error(`删除失败：${errorMessage(e)}`)
      return false
    }
  }

  return { persistNodeName, persistFlowSteps, deleteCanvasNode }
}
