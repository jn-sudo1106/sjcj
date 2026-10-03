import { configApi, type Config } from '@/api'

export interface ParamConfigUsage { configId: string; name: string }
export interface ParamUsageResult { configs: ParamConfigUsage[]; checked: number; total: number; failed: number }

/** 旧接口没有按 paramId 反查配置；按页遍历配置并核对其真实绑定记录。 */
export async function findParamConfigUsage(paramId: string, onProgress?: (checked: number, total: number) => void, shouldContinue: () => boolean = () => true): Promise<ParamUsageResult> {
  const configs: Config[] = []
  const pageSize = 200
  const first = await configApi.configPaged({ page: 1, size: pageSize })
  configs.push(...first.list)
  const total = first.total
  for (let page = 2; (page - 1) * pageSize < total; page++) {
    if (!shouldContinue()) break
    const result = await configApi.configPaged({ page, size: pageSize })
    configs.push(...result.list)
  }

  const matches: ParamConfigUsage[] = []
  let checked = 0
  let failed = 0
  const workers = Array.from({ length: Math.min(8, configs.length) }, async (_, worker) => {
    for (let index = worker; index < configs.length; index += 8) {
      if (!shouldContinue()) break
      const config = configs[index]
      try {
        const bindings = await configApi.configParams(config.configId, { page: 1, size: pageSize })
        let found = bindings.list.some((binding) => binding.paramId === paramId)
        for (let page = 2; !found && (page - 1) * pageSize < bindings.total; page++) {
          const next = await configApi.configParams(config.configId, { page, size: pageSize })
          found = next.list.some((binding) => binding.paramId === paramId)
        }
        if (found) {
          matches.push({ configId: config.configId, name: config.name })
        }
      } catch {
        failed++
      } finally {
        checked++
        onProgress?.(checked, total)
      }
    }
  })
  await Promise.all(workers)
  return { configs: matches.sort((a, b) => a.name.localeCompare(b.name)), checked, total, failed }
}
