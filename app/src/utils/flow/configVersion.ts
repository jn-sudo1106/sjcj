import { configApi } from '@/api'
import { useFlowStore } from '@/stores/flow'

/**
 * 配置保存成功后刷新 updateDt（并发编辑校验的版本号）。
 *
 * 同一份配置可能被画布里多个节点引用，保存后它们手里的加载时版本都过期了，
 * 所以按 configId 同步给全部节点，而不是只改正在保存的那个。
 * 读不到时置空：下次保存退回用保存时现取的值，不会被旧版本号误拒。
 */
export async function refreshConfigUpdateDt(configId: string): Promise<string | undefined> {
  const updateDt = (await configApi.configDetail(configId).catch(() => null))?.updatedAt
  useFlowStore().syncConfigUpdateDt(configId, updateDt)
  return updateDt
}
