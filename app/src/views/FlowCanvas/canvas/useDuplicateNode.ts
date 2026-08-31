// 复制节点（0828 D02：复制节点 = 新增一套配置）。
//
// 分两步，顺序不能反：
//   ① store.duplicate() 同步复制节点结构，**副本不带 configId**——这一步就把"改副本=改原件"的风险断掉了；
//   ② config/copyAll 复制出一份真正的新配置，绑回副本。
//
// 第 ② 步失败只会让副本停在「未绑定配置」，不会污染原配置。这是把 ① 做成同步、
// 且不在失败时回滚节点的原因：宁可留一个待补配置的节点，也不要一个指向原件的节点。
import { ElMessage } from 'element-plus'
import { configApi } from '@/api'
import { useFlowStore } from '@/stores/flow'

export function useDuplicateNode() {
  const flow = useFlowStore()

  return async function duplicateNode(id: string): Promise<string | undefined> {
    const src = flow.configs[id]
    const fromConfigId = src?.configId
    const fromConfigName = src?.configName ?? ''

    const newId = flow.duplicate(id)
    if (!newId) return undefined

    // 原节点本来就没绑配置（新建态），没有可复制的源，副本保持新建态即可。
    if (!fromConfigId) return newId

    try {
      const copied = await configApi.copyConfigAndLocate(fromConfigId, fromConfigName)
      if (!copied.ok) {
        ElMessage.warning(`节点已复制，但配置复制失败：${copied.message}。请在该节点上重新保存以生成配置`)
        return newId
      }
      flow.bindCopiedConfig(newId, copied.configId, copied.name)
      ElMessage.success(`已复制节点，并生成新配置 #${copied.configId}`)
    } catch (e) {
      ElMessage.warning(`节点已复制，但配置复制失败：${(e as Error)?.message ?? String(e)}。请在该节点上重新保存以生成配置`)
    }
    return newId
  }
}
