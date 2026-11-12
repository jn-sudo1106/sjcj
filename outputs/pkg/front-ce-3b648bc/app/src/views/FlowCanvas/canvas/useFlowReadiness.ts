// 流程就绪检查（2026-10-14）：发布、发起抓取（以后手工运行草稿）前统一走这一个方法。
// 草稿里允许节点暂时不完整，到这些动作前才拦：先把画布改动落库，再查节点完整性和保存状态；
// 输入表与上游输出表不一致只提示、不拦。
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { collectFlowIssues, collectTableMismatches } from '@/utils/flow/stepPersist'
import { useFlowAutosave } from './useFlowAutosave'

export function useFlowReadiness() {
  const flow = useFlowStore()
  const sourceStore = useSourceStore()
  const { flush, status } = useFlowAutosave()

  /** 不通过时选中第一个问题节点并提示，返回 false。action 是动作名，用在提示文案里（如「发布」）。 */
  async function ensureFlowReady(action: string): Promise<boolean> {
    await flush()
    const issues = collectFlowIssues(flow.main, flow.branchGroups, flow.configs, sourceStore.stepSnapshots)
    if (issues.length) {
      flow.select(issues[0].nodeId)
      ElMessage.warning(`${action}前需补全 ${issues.length} 个节点：${issues.map((i) => `「${i.title}」${i.message}`).join('；')}`)
      return false
    }
    if (flow.flowDirty || status.value === 'error' || status.value === 'pending') {
      ElMessage.warning(`流程尚未保存，请先处理头部的保存提示，再${action}`)
      return false
    }
    if (flow.configDirty) {
      const pending = flow.dirtyConfigNodes[0]
      flow.select(pending)
      ElMessage.warning(`节点「${flow.configs[pending]?.title || pending}」的配置尚未保存，请先在右侧保存节点配置`)
      return false
    }
    // 表衔接只提示、不拦截（2026-10-14 定）
    const mismatches = collectTableMismatches(flow.main, flow.branchGroups, flow.configs)
    if (mismatches.length) {
      ElMessage.warning({ message: `提示：${mismatches.map((i) => `「${i.title}」${i.message}`).join('；')}`, duration: 6000 })
    }
    return true
  }

  return { ensureFlowReady }
}
