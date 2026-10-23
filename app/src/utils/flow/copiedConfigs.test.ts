// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mockSteps = vi.fn()
const mockCopyAndLocate = vi.fn()
const mockStepModify = vi.fn()
const mockRootConfigUpdate = vi.fn()
const mockConfirm = vi.fn()
const mockOverview = vi.fn(async () => ({ enabled: false, versions: [], draftId: null as string | null }))

vi.mock('@/api', () => ({
  flowCenterApi: { steps: (...args: unknown[]) => mockSteps(...args) },
  configApi: { copyConfigAndLocate: (...args: unknown[]) => mockCopyAndLocate(...args) },
  itemApi: {
    stepModify: (...args: unknown[]) => mockStepModify(...args),
    rootConfigUpdate: (...args: unknown[]) => mockRootConfigUpdate(...args),
  },
  // 流程版本（2026-10-10）：按未启用处理，换绑照旧不带版本信息
  flowVersionApi: { overview: (...args: unknown[]) => mockOverview(...(args as [])), action: vi.fn() },
  versionArgs: (ref: unknown) => (ref ? [ref] : []),
}))

vi.mock('element-plus', async () => {
  const actual = await vi.importActual<typeof import('element-plus')>('element-plus')
  return { ...actual, ElMessageBox: { confirm: (...args: unknown[]) => mockConfirm(...args) } }
})

import {
  assertConfigWritable,
  clearDetachFailure,
  detachConfigsInPlace,
  detachCopiedConfigs,
  detachFailureFor,
  registerDetachFailure,
} from './copiedConfigs'
import type { Step } from '@/api'

const step = (over: Partial<Step>): Step => ({
  stepId: '9001',
  sourceId: '-1',
  name: '9001-详情',
  configId: '1400917',
  url: '$VAL$',
  mainConfig: '1400917',
  flowId: '1100',
  enabled: true,
  ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  mockSteps.mockReset()
  mockCopyAndLocate.mockReset()
  mockStepModify.mockReset()
  mockRootConfigUpdate.mockReset()
  mockConfirm.mockReset()
})

describe('detachCopiedConfigs（复制流程后配置去共享）', () => {
  it('普通步骤走 stepModify 换绑、根节点走 rootConfigUpdate，全部成功', async () => {
    mockSteps.mockResolvedValue([
      step({ stepId: '1001', isRoot: true, configId: '1000' }),
      step({ stepId: '1002', configId: '1400917', configName: '1400917-详情' }),
      step({ stepId: '1003', configId: '1400918' }),
    ])
    mockCopyAndLocate.mockImplementation(async (cid: string) => ({ ok: true, configId: `5${cid}`, name: `${cid}_copy` }))
    mockStepModify.mockResolvedValue({ ok: true })
    mockRootConfigUpdate.mockResolvedValue({ ok: true })

    const result = await detachCopiedConfigs('1100', { sourceFlowRef: '模板「T」' })

    expect(result.ok).toBe(true)
    expect(result.copied).toBe(3)
    expect(result.remainShared).toBe(0)
    // 根节点最小集换绑
    expect(mockRootConfigUpdate).toHaveBeenCalledWith('1001', '51000', '1100')
    // 普通步骤整包回写 + 新 configId
    expect(mockStepModify).toHaveBeenCalledTimes(2)
    expect(mockStepModify).toHaveBeenCalledWith(expect.objectContaining({ stepId: '1002', configId: '51400917' }))
    expect(mockStepModify).toHaveBeenCalledWith(expect.objectContaining({ stepId: '1003', configId: '51400918' }))
  })

  it('复制失败的步骤登记为残留共享，其余继续换绑', async () => {
    mockSteps.mockResolvedValue([
      step({ stepId: '1002', configId: '1400917' }),
      step({ stepId: '1003', configId: '1400918' }),
    ])
    mockCopyAndLocate.mockImplementation(async (cid: string) => (cid === '1400917'
      ? { ok: false as const, message: '复制失败' }
      : { ok: true as const, configId: '51400918', name: 'x' }))
    mockStepModify.mockResolvedValue({ ok: true })

    const progress: Array<[number, number]> = []
    const result = await detachCopiedConfigs('1100', {
      sourceFlowRef: '模板「T」',
      onProgress: (d, t) => progress.push([d, t]),
    })

    expect(result.copied).toBe(1)
    expect(result.remainShared).toBe(1)
    expect(mockStepModify).toHaveBeenCalledTimes(1)
    expect(detachFailureFor('1400917')).toMatchObject({ configId: '1400917', flowId: '1100', sourceFlowRef: '模板「T」' })
    // 进度首尾回调
    expect(progress[0]).toEqual([0, 2])
    expect(progress[progress.length - 1]).toEqual([2, 2])
  })

  it('onlyStepIds 只处理新增步骤，不碰目标流程原有步骤', async () => {
    mockSteps.mockResolvedValue([
      step({ stepId: '2001', configId: '3001' }),
      step({ stepId: '2002', configId: '3002' }),
    ])
    mockCopyAndLocate.mockResolvedValue({ ok: true, configId: '7001', name: 'c' })
    mockStepModify.mockResolvedValue({ ok: true })

    const result = await detachCopiedConfigs('1100', { onlyStepIds: new Set(['2002']) })

    expect(result.copied).toBe(1)
    expect(mockStepModify).toHaveBeenCalledTimes(1)
    expect(mockStepModify).toHaveBeenCalledWith(expect.objectContaining({ stepId: '2002', configId: '7001' }))
  })

  it('步骤读取失败：返回 ok:false 且不登记', async () => {
    mockSteps.mockRejectedValue(new Error('超时'))
    const result = await detachCopiedConfigs('1100')
    expect(result.ok).toBe(false)
    expect(result.copied).toBe(0)
    expect(mockCopyAndLocate).not.toHaveBeenCalled()
  })

  it('草稿步骤 / 无配置步骤直接跳过', async () => {
    mockSteps.mockResolvedValue([
      step({ stepId: 'node-1', configId: '1400917' }), // 草稿 id
      step({ stepId: '1002', configId: '' }), // 无配置
      step({ stepId: '1003', configId: 'not-a-number' }),
    ])
    const result = await detachCopiedConfigs('1100')
    expect(result.copied).toBe(0)
    expect(mockCopyAndLocate).not.toHaveBeenCalled()
  })

  it('同一 configId 被多个步骤共用：只复制一份，所有步骤换绑到同一个新配置', async () => {
    // 源流程里两个步骤指向同一 cs_config（cs_item_config 多行共用一个 configId 是实测常态）
    mockSteps.mockResolvedValue([
      step({ stepId: '1002', configId: '1400917', configName: '1400917-详情' }),
      step({ stepId: '1003', configId: '1400917', configName: '1400917-详情' }),
    ])
    mockCopyAndLocate.mockResolvedValue({ ok: true, configId: '51400917', name: '1400917-详情_copy' })
    mockStepModify.mockResolvedValue({ ok: true })

    const result = await detachCopiedConfigs('1100')

    expect(result.copied).toBe(2)
    expect(result.remainShared).toBe(0)
    // 复制只发生一次
    expect(mockCopyAndLocate).toHaveBeenCalledTimes(1)
    expect(mockCopyAndLocate).toHaveBeenCalledWith('1400917', '1400917-详情')
    // 两个步骤换绑到同一个新配置；步骤行其余字段保留
    expect(mockStepModify).toHaveBeenCalledTimes(2)
    expect(mockStepModify).toHaveBeenCalledWith(expect.objectContaining({ stepId: '1002', configId: '51400917' }))
    expect(mockStepModify).toHaveBeenCalledWith(expect.objectContaining({ stepId: '1003', configId: '51400917' }))
  })

  it('共用配置复制失败：复制不缓存失败，共用它的步骤各自重试一次', async () => {
    // 失败不写入 clonedBySource 缓存 → 第二个步骤会再试一次：瞬时失败有机会在下次尝试成功。
    mockSteps.mockResolvedValue([
      step({ stepId: '1002', configId: '1400917' }),
      step({ stepId: '1003', configId: '1400917' }),
    ])
    mockCopyAndLocate.mockResolvedValue({ ok: false, message: '复制失败' })

    const result = await detachCopiedConfigs('1100')

    expect(result.copied).toBe(0)
    expect(result.remainShared).toBe(2)
    expect(mockCopyAndLocate).toHaveBeenCalledTimes(2)
    // 登记覆盖式写入：同一 (configId, flowId) 只留一条
    expect(detachFailureFor('1400917', '1100')).toMatchObject({ configId: '1400917', flowId: '1100' })
  })

  it('步骤读取用 withConfigDetails:true（需要 configName 做复制命名）', async () => {
    mockSteps.mockResolvedValue([step({ stepId: '1002', configId: '1400917' })])
    mockCopyAndLocate.mockResolvedValue({ ok: true, configId: '51400917', name: 'c' })
    mockStepModify.mockResolvedValue({ ok: true })
    await detachCopiedConfigs('1100')
    expect(mockSteps).toHaveBeenCalledWith('1100', { withConfigDetails: true })
  })
})

describe('detachCopiedConfigs · 只有草稿的复制品（1016）', () => {
  it('复制出的流程有草稿时按草稿读步骤（不带版本读只认发布版，草稿流程会报错）', async () => {
    mockOverview.mockResolvedValueOnce({ enabled: true, versions: [], draftId: '1081' })
    mockSteps.mockResolvedValue([])
    await detachCopiedConfigs('21000047')
    expect(mockSteps).toHaveBeenLastCalledWith('21000047', { withConfigDetails: true, versionId: '1081' })
  })
})

describe('残留登记与知情确认', () => {
  it('登记 / 查询 / 清除', () => {
    registerDetachFailure('888', '1100', '模板「T」')
    expect(detachFailureFor('888')).toMatchObject({ configId: '888', flowId: '1100' })
    expect(detachFailureFor('999')).toBeUndefined()
    clearDetachFailure('888')
    expect(detachFailureFor('888')).toBeUndefined()
  })

  it('无登记：直接放行，不弹确认', async () => {
    expect(await assertConfigWritable('123')).toBe(true)
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('有登记且用户确认：放行并清除登记', async () => {
    registerDetachFailure('888', '1100', '模板「T」')
    mockConfirm.mockResolvedValue('confirm')
    expect(await assertConfigWritable('888')).toBe(true)
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    expect(detachFailureFor('888')).toBeUndefined()
  })

  it('有登记且用户取消：不放行，登记保留', async () => {
    registerDetachFailure('888', '1100', '模板「T」')
    mockConfirm.mockRejectedValue(new Error('cancel'))
    expect(await assertConfigWritable('888')).toBe(false)
    expect(detachFailureFor('888')).toBeDefined()
  })

  it('带 flowId 精确匹配：只清当前流程的登记，同配置其它流程的登记保留', async () => {
    registerDetachFailure('888', '1100', '模板「T」')
    registerDetachFailure('888', '2000', '模板「S」')
    mockConfirm.mockResolvedValue('confirm')

    expect(await assertConfigWritable('888', '1100')).toBe(true)

    expect(detachFailureFor('888', '1100')).toBeUndefined()
    // 另一条流程的同配置登记未被误清——它的知情确认仍然有效
    expect(detachFailureFor('888', '2000')).toMatchObject({ flowId: '2000', sourceFlowRef: '模板「S」' })
  })

  it('知情确认弹窗文案：说清共享来源与影响面（文案回归保护）', async () => {
    registerDetachFailure('888', '1100', '模板「标准资讯流程」')
    mockConfirm.mockResolvedValue('confirm')
    await assertConfigWritable('888', '1100')
    const [message, title] = mockConfirm.mock.calls[0] as [string, string]
    expect(String(title)).toBe('修改共享配置')
    expect(String(message)).toContain('仍与模板「标准资讯流程」共享')
    expect(String(message)).toContain('影响该流程及所有使用它的源')
  })
})

describe('detachConfigsInPlace（本地拼装路径去共享，0929 补漏）', () => {
  it('画布内每个带数字 configId 的节点复制一份新配置并就地换绑', async () => {
    mockCopyAndLocate.mockImplementation(async (cid: string) => ({ ok: true, configId: `3${cid}`, name: `${cid}_copy` }))
    const configs = {
      // 空 configId / 草稿节点不参与
      'draft-1': { configId: '', title: '草稿' },
      'real-1': { configId: '1400917', title: '采集-新闻' },
      'real-2': { configId: '1400917', title: '采集-新闻-2' },
      'real-3': { configId: '1400918', title: '监控-库存' },
    }

    const result = await detachConfigsInPlace(configs, { flowId: '1100', sourceFlowRef: '模板「T」' })

    expect(result.copied).toBe(3)
    expect(result.remainShared).toBe(0)
    // 同一 configId 只复制一份，两个节点换绑到同一个新配置
    expect(mockCopyAndLocate).toHaveBeenCalledTimes(2)
    expect(configs['real-1'].configId).toBe('31400917')
    expect(configs['real-2'].configId).toBe('31400917')
    expect(configs['real-3'].configId).toBe('31400918')
    expect(configs['draft-1'].configId).toBe('')
  })

  it('复制失败：就地不动、登记知情确认，其余节点继续换绑', async () => {
    mockCopyAndLocate.mockImplementation(async (cid: string) =>
      cid === '1400917' ? { ok: false, message: '复制失败' } : { ok: true, configId: `3${cid}` })
    const configs = {
      'a-1': { configId: '1400917' },
      'b-1': { configId: '1400918' },
    }

    const result = await detachConfigsInPlace(configs, { flowId: '7', sourceFlowRef: '模板「T」' })

    expect(result.copied).toBe(1)
    expect(result.remainShared).toBe(1)
    expect(configs['a-1'].configId).toBe('1400917') // 失败不改
    expect(configs['b-1'].configId).toBe('31400918')
    // 登记（configId, flowId）精确匹配，供 assertConfigWritable 拦截
    expect(detachFailureFor('1400917', '7')?.sourceFlowRef).toBe('模板「T」')
  })

  it('没有任何数字 configId：不调接口、直接成功返回', async () => {
    const result = await detachConfigsInPlace({ 'x-1': { configId: '' }, 'x-2': { configId: undefined } })
    expect(result).toEqual({ ok: true, copied: 0, remainShared: 0 })
    expect(mockCopyAndLocate).not.toHaveBeenCalled()
  })
})