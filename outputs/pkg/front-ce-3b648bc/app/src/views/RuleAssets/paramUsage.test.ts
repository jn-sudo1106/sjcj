import { describe, expect, it, vi } from 'vitest'
import { configApi, type Config } from '@/api'
import { findParamConfigUsage } from './paramUsage'

describe('findParamConfigUsage', () => {
  it('核对所有配置的真实绑定，并报告查询失败项', async () => {
    vi.spyOn(configApi, 'configPaged').mockResolvedValue({
      total: 3,
      list: [
        { configId: '1', name: '采集配置' },
        { configId: '2', name: '任务配置' },
        { configId: '3', name: '失效配置' },
      ] as Config[],
    })
    vi.spyOn(configApi, 'configParams').mockImplementation(async (id) => {
      if (id === '3') throw new Error('网络错误')
      return { total: 1, list: [{ id, paramId: id === '2' ? 'p1' : 'p2', paramName: '参数' }] }
    })
    const progress = vi.fn()
    const result = await findParamConfigUsage('p1', progress)
    expect(result).toEqual({ configs: [{ configId: '2', name: '任务配置' }], checked: 3, total: 3, failed: 1 })
    expect(progress).toHaveBeenCalledWith(3, 3)
    vi.restoreAllMocks()
  })
})
