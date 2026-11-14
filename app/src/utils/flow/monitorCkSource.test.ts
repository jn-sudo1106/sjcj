import { afterEach, describe, expect, it, vi } from 'vitest'
import { ckSourceApi, entryApi } from '@/api'
import * as monitorApi from '@/api/monitor'
import type { NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { describeCkSourceConflictRows, MultipleCkSourceRowsError, syncMonitorAlertConfig, syncMonitorCkSource } from './monitorCkSource'

function makeMonitorNode(patch: Partial<NodeConfig> = {}): NodeConfig {
  const node: NodeConfig = {
    title: '库存监控',
    sub: '',
    status: '待配置',
    planned: false,
    template: 'monitor',
    kind: 'node',
    base: [],
    fields: [],
    inmap: [],
    params: [],
    output: [],
    ruleCfg: {
      mode: 'ref',
      scriptPath: '/code01/184.py',
      inputTable: 'sense_data.TB_JD_SKU_BASE',
      describe: '监控库存',
    },
    schedule: { scheduleType: 'daily', scheduleTime: '08:00', weekdays: [], cron: '0 0 8 * * ?' },
    monitorMethods: ['数据延迟监控'],
    alertConfig: {
      enabled: true,
      policies: [{
        name: '数据延迟超过阈值',
        metric: 'delay_minutes',
        operator: 'gt',
        threshold: '30',
        consecutiveCount: 3,
        repeatMinutes: 30,
        recoveryNotify: true,
        enabled: true,
        channelTypes: ['email'],
      }],
      channels: [{ type: 'email', enabled: true, target: 'ops@example.com' }],
    },
  }
  return Object.assign(node, patch)
}

// 每条用例都 spy 同一批 ckSourceApi 方法：不还原的话 mock.calls 会跨用例累积，
// "第 N 次调用"的断言就会读到上一条用例的调用记录。
afterEach(() => vi.restoreAllMocks())

describe('syncMonitorCkSource', () => {
  it('已有记录 update 时保留旧 checkConf 字段，并合入告警配置字段', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{
      id: 7,
      ver: 9001,
      sourceId: 430016501,
      name: '旧监控',
      checkConf: JSON.stringify({
        customKeep: 'keep-me',
        kind: 'source_result',
        script: '/code01/alert.py',
        minSize: '1',
        startDt: 'DATE_SUB(CURDATE(), INTERVAL 7 DAY)',
        cond: 'old cond',
        notifyOn: 'success',
        notifyType: 'dingtalk',
      }),
    }])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})
    const add = vi.spyOn(monitorApi, 'addSourceCheck')

    await syncMonitorCkSource('430016501', makeMonitorNode())

    expect(add).not.toHaveBeenCalled()
    const payload = update.mock.calls[0][0]
    expect(payload).toMatchObject({
      sourceId: 430016501,
      name: '库存监控',
      schedule: '0 0 8 * * ?',
      tableName: 'sense_data.TB_JD_SKU_BASE',
    })
    // 2026-11-12 最小保护：update 不再写生命周期字段，画布保存不能重新启用已停用的检查项，
    // 也不能改创建时间/版本号（这几个字段属于监控记录自身，只由监控中心或调度侧维护）。
    expect(payload).not.toHaveProperty('state')
    expect(payload).not.toHaveProperty('isDelete')
    expect(payload).not.toHaveProperty('createDt')
    // 更新走 C01 按主键：带上 id 与当前 ver（乐观锁基线），不再按 sourceId 整包覆盖。
    expect(payload).toMatchObject({ id: 7, ver: 9001 })
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.customKeep).toBe('keep-me')
    // 1113 设计修订稿：画布节点侧显式写 scopeType='node_input'，且不能洗掉原有键
    expect(conf.scopeType).toBe('node_input')
    expect(conf.kind).toBe('source_result')
    expect(conf.script).toBe('/code01/alert.py')
    expect(conf.minSize).toBe('30')
    expect(conf.startDt).toBe('DATE_SUB(CURDATE(), INTERVAL 7 DAY)')
    expect(conf.cond).toContain('数据延迟超过阈值')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
    expect(conf.monitorMethods).toEqual(['数据延迟监控'])
    expect(conf.orchestration).toMatchObject({ scriptPath: '/code01/184.py' })
  })

  it('关闭告警写后端认得的静音策略 none，而不是 disabled', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{
      id: 7,
      ver: 9001,
      sourceId: 430016501,
      name: '旧监控',
      checkConf: JSON.stringify({ kind: 'source_result', notifyOn: 'error' }),
    }])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})
    const node = makeMonitorNode()
    const alertConfig = { ...node.alertConfig!, enabled: false }

    await syncMonitorAlertConfig('430016501', node, alertConfig)

    const conf = JSON.parse(String(update.mock.calls[0][0].checkConf ?? '{}'))
    // 后端 NOTIFY_POLICIES 只有 none/error/ok/all，非法值会被归一成 error；
    // 写 disabled 等于「用户关了告警，异常照旧发邮件」（2026-11-13 修复）。
    expect(conf.notifyOn).toBe('none')
  })

  it('同源已有多个检查项时拒绝覆盖，不再按 sourceId 整包更新', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      { id: 7, sourceId: 430016501, name: '检查项A', checkConf: '{}' },
      { id: 8, sourceId: 430016501, name: '检查项B', checkConf: '{}' },
    ])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck')
    const add = vi.spyOn(monitorApi, 'addSourceCheck')

    const error = await syncMonitorCkSource('430016501', makeMonitorNode()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MultipleCkSourceRowsError)
    // message 保持旧文案（既有调用方/测试都按这句断言），同时把冲突行带出来给 UI 列清单。
    expect((error as Error).message).toMatch(/已有 2 条检查项/)
    expect((error as MultipleCkSourceRowsError).count).toBe(2)
    expect((error as MultipleCkSourceRowsError).rows.map((row) => row.id)).toEqual([7, 8])
    expect(update).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })

  it('无记录新建时写入默认 startDt 与告警配置字段', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const add = vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ id: 101, ver: null })

    await syncMonitorCkSource('430016501', makeMonitorNode())

    const payload = add.mock.calls[0][0] as Record<string, unknown>
    // 新建走 C01 /api/v1/source/check/add：生命周期字段由后端 addObject 补
    // （createDt / state='C' / isDelete=0 / nextRun），前端不再自己填，避免和调度侧口径分叉。
    expect(payload).toMatchObject({ sourceId: 430016501, name: '库存监控' })
    expect(payload).not.toHaveProperty('state')
    expect(payload).not.toHaveProperty('isDelete')
    expect(payload).not.toHaveProperty('createDt')
    expect(payload).not.toHaveProperty('ver')
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.scopeType).toBe('node_input')
    expect(conf.minSize).toBe('30')
    expect(conf.startDt).toBe('DATE_SUB(CURDATE(), INTERVAL 1 DAY)')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
  })

  // 节点配置 Tab 的 cron 框对非「自定义 cron」的策略显示的是**推导值**，store 里不一定有 cron。
  // 保存必须落这个推导值，否则出现「界面显示 0 0 8 * * ?、ck_source.SCHEDULE 是空」。
  it('schedule 按节点配置 Tab 的定时策略推导，不依赖 store 里已存的 cron', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const add = vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ id: 101, ver: null })

    await syncMonitorCkSource('430016501', makeMonitorNode({
      schedule: { scheduleType: '每天', scheduleTime: '08:00', weekdays: [], cron: '' },
    }))

    expect(add.mock.calls[0][0]).toMatchObject({ schedule: '0 0 8 * * ?' })
  })

  // 节点没配过定时 → 节点配置 Tab 显示的是源上的定时，落库要用同一个值。
  it('节点没配定时时用画布当前源的定时设置', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const add = vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ id: 101, ver: null })

    await syncMonitorCkSource('430016501', makeMonitorNode({ schedule: undefined }), {
      scheduleType: '交易日定时', scheduleTime: '08:30', weekdays: [1, 2, 3, 4, 5], cron: '',
    })

    expect(add.mock.calls[0][0]).toMatchObject({ schedule: '0 30 8 ? * 1-5' })
  })

  // 一点定时都没配时，节点配置 Tab 那个 cron 框显示的是「每天 0:0」的兜底推导值——
  // 保存按界面口径照写，不再留空（空串等于这条监控不会被排期）。
  it('定时一点没配时 schedule 取节点配置 Tab 的兜底显示值', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const add = vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ id: 101, ver: null })

    await syncMonitorCkSource('430016501', makeMonitorNode({ schedule: undefined, collectCfg: undefined }))

    expect(add.mock.calls[0][0]).toMatchObject({ schedule: '0 0 0 * * ?' })
  })

  // 流程重新加载后只剩输入表 ID（物理表名不落步骤），表配置 Tab 显示的是那张表，
  // 落库也要拿到它的物理表名，而不是把 ID 写进 TABLE_NAME 或者写空。
  it('只有输入表 ID 时回查表详情取物理表名', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const add = vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ id: 101, ver: null })
    const detail = vi.spyOn(entryApi, 'entryDetail').mockResolvedValue({
      tableId: '2102154', tableName: 'sense_data.TB_JD_SKU_BASE', name: '酒价基础表', fields: [],
    })

    await syncMonitorCkSource('430016501', makeMonitorNode({
      ruleCfg: { mode: 'ref', scriptPath: '/code01/184.py', describe: '', inputTable: '', inputTableId: '2102154' },
    }))

    expect(detail).toHaveBeenCalledWith('2102154')
    expect(add.mock.calls[0][0]).toMatchObject({ tableName: 'sense_data.TB_JD_SKU_BASE' })
  })

  it('回查表详情失败时 tableName 留空，不抛出去打断保存', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const add = vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ id: 101, ver: null })
    vi.spyOn(entryApi, 'entryDetail').mockRejectedValue(new Error('表详情不可用'))

    await syncMonitorCkSource('430016501', makeMonitorNode({
      ruleCfg: { mode: 'ref', scriptPath: '/code01/184.py', describe: '', inputTable: '', inputTableId: '2102154' },
    }))

    expect(add.mock.calls[0][0]).toMatchObject({ tableName: '' })
  })
})

// 监控视图「监控配置」Tab 专用通路（2026-09-16）：只有告警面板，节点是从步骤种子拼的骨架，
// 不能用它整包重建 checkConf——监控方法、脚本路径、输入表都是线上真实值，被默认值盖掉就是事故。
describe('syncMonitorAlertConfig', () => {
  it('已有记录只改告警字段，监控方法与编排原样保留', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{
      id: 7,
      ver: 9001,
      sourceId: 430016501,
      name: '库存监控',
      checkConf: JSON.stringify({
        customKeep: 'keep-me',
        minSize: '1',
        startDt: 'DATE_SUB(CURDATE(), INTERVAL 7 DAY)',
        cond: 'old cond',
        notifyOn: 'success',
        notifyType: 'dingtalk',
        monitorMethods: ['当日数据是否正常入库'],
        orchestration: { inputTable: 'sense_data.TB_JD_SKU_BASE', scriptPath: '/code01/real.py' },
      }),
    }])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})
    const add = vi.spyOn(monitorApi, 'addSourceCheck')

    const node = makeMonitorNode()
    await syncMonitorAlertConfig('430016501', node, node.alertConfig)

    expect(add).not.toHaveBeenCalled()
    const payload = update.mock.calls[0][0]
    // 只带 checkConf：name/schedule/tableName 交给节点保存那条通路，这里不碰
    expect(payload).toEqual({
      id: 7,
      ver: 9001,
      sourceId: 430016501,
      checkConf: expect.any(String),
    })
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.customKeep).toBe('keep-me')
    expect(conf.minSize).toBe('30')
    expect(conf.cond).toContain('数据延迟超过阈值')
    expect(conf.notifyOn).toBe('error')
    expect(conf.notifyType).toBe('mail')
    // 关键：种子节点里 monitorMethods=['数据延迟监控']、scriptPath='/code01/184.py' 都不许写回去
    expect(conf.monitorMethods).toEqual(['当日数据是否正常入库'])
    expect(conf.orchestration.scriptPath).toBe('/code01/real.py')
  })

  it('告警总开关关掉时写静音策略 notifyOn=none', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([{ id: 7, ver: 9001, sourceId: 430016501, checkConf: '{}' }])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})

    const node = makeMonitorNode()
    await syncMonitorAlertConfig('430016501', node, { ...node.alertConfig!, enabled: false })

    const conf = JSON.parse(String(update.mock.calls[0][0].checkConf ?? '{}'))
    // 必须是后端白名单里的 none；写 disabled 会被归一成 error，等于没静音。
    expect(conf.notifyOn).toBe('none')
    expect(conf.scopeType).toBe('node_input')
  })

  it('该源还没有 ck_source 行时按节点建行，不静默失败', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([])
    const add = vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ id: 101, ver: null })

    const node = makeMonitorNode()
    await syncMonitorAlertConfig('430016501', node, node.alertConfig)

    const payload = add.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ sourceId: 430016501, name: '库存监控' })
    expect(payload).not.toHaveProperty('state')
    expect(JSON.parse(String(payload.checkConf ?? '{}')).scopeType).toBe('node_input')
  })

  it('缺少源 ID 时报错，不写出一条无源记录', async () => {
    const list = vi.spyOn(ckSourceApi, 'list')
    const add = vi.spyOn(monitorApi, 'addSourceCheck')

    await expect(syncMonitorAlertConfig('  ', makeMonitorNode(), undefined)).rejects.toThrow('缺少源 ID')
    expect(list).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
  })
})

// 冲突清单给保存失败提示直接用：用户在画布上要知道「到底是哪几条」，才能去监控中心处理。
describe('describeCkSourceConflictRows', () => {
  const base = { sourceId: 430016501 }

  it('逐条列出名称｜id｜表｜启停｜更新时间', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '检查项A', tableName: 'sense_data.TB_X', isDelete: 0, state: 'E', updateDt: '2026-09-18T10:00:00' },
      { ...base, id: 8, name: '检查项B', tableName: 'sense_data.TB_Y', isDelete: 1, state: 'D', updateDt: '2026-09-19T03:05:09' },
    ])).toEqual([
      '检查项A｜id=7｜表=sense_data.TB_X｜在用｜更新 2026-09-18 10:00',
      '检查项B｜id=8｜表=sense_data.TB_Y｜已停用｜更新 2026-09-19 03:05',
    ])
  })

  it('name 为空时写「未命名检查项」', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '   ', tableName: 'sense_data.TB_X', isDelete: 0, state: 'E' },
    ])).toEqual(['未命名检查项｜id=7｜表=sense_data.TB_X｜在用'])
  })

  it('tableName 为空时省略「表=…」', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '检查项A', tableName: '', isDelete: 0, state: 'E' },
    ])).toEqual(['检查项A｜id=7｜在用'])
  })

  it('按 isDelete 判启停：0 在用、1 及其它停用；state 不参与', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '检查项A', isDelete: 1, state: 'C' },
      { ...base, id: 8, name: '检查项B', state: 'E' },
    ])).toEqual(['检查项A｜id=7｜已停用', '检查项B｜id=8｜已停用'])
  })

  it('updateDt 缺省时省略「更新 …」', () => {
    expect(describeCkSourceConflictRows([
      { ...base, id: 7, name: '检查项A', isDelete: 0, state: 'E', updateDt: '  ' },
    ])).toEqual(['检查项A｜id=7｜在用'])
  })
})

describe('syncMonitorCkSource · C12 节点显式绑定（check_conf.binding）', () => {
  const options = { workflowId: '451', nodeKey: 'web-list-1' }

  it('同源多条时按 nodeKey 认领本节点那条：只更新它，不再因「多条」停手', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      { id: 7, ver: 11, sourceId: 430016501, name: '别的节点', checkConf: JSON.stringify({ binding: { workflowId: '451', nodeKey: 'web-list-2', bindingVersion: 1 } }) },
      { id: 8, ver: 12, sourceId: 430016501, name: '本节点', tableName: 'sense_data.TB_JD_SKU_BASE', checkConf: JSON.stringify({ binding: { workflowId: '451', nodeKey: 'web-list-1', bindingVersion: 1 } }) },
    ])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})
    const add = vi.spyOn(monitorApi, 'addSourceCheck')

    await syncMonitorCkSource('430016501', makeMonitorNode(), undefined, options)

    expect(add).not.toHaveBeenCalled()
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ id: 8, ver: 12 })
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.binding).toMatchObject({ workflowId: '451', nodeKey: 'web-list-1', bindingVersion: 1 })
    // 范围没变：boundAt 沿用旧值语义（此处旧记录没有 boundAt，首次补齐即可）
    expect(typeof conf.binding.boundAt).toBe('string')
  })

  it('唯一一条旧记录没有 binding 时收养它，并补写绑定（bindingVersion 从 1 开始）', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      { id: 7, ver: 11, sourceId: 430016501, name: '旧监控', tableName: 'sense_data.TB_JD_SKU_BASE', checkConf: JSON.stringify({ customKeep: 'keep-me' }) },
    ])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})
    const add = vi.spyOn(monitorApi, 'addSourceCheck')

    await syncMonitorCkSource('430016501', makeMonitorNode(), undefined, options)

    expect(add).not.toHaveBeenCalled()
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ id: 7, ver: 11 })
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.customKeep).toBe('keep-me')
    expect(conf.binding).toMatchObject({ workflowId: '451', nodeKey: 'web-list-1', bindingVersion: 1 })
  })

  it('唯一一条但绑定的是别的节点时另建一条（一个源两个监控节点不再互相覆盖）', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      { id: 7, ver: 11, sourceId: 430016501, name: '别的节点', checkConf: JSON.stringify({ binding: { workflowId: '451', nodeKey: 'web-list-2', bindingVersion: 1 } }) },
    ])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck')
    const add = vi.spyOn(monitorApi, 'addSourceCheck').mockResolvedValue({ id: 102, ver: null })

    await syncMonitorCkSource('430016501', makeMonitorNode(), undefined, options)

    expect(update).not.toHaveBeenCalled()
    const payload = add.mock.calls[0][0] as Record<string, unknown>
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    expect(conf.binding).toMatchObject({ workflowId: '451', nodeKey: 'web-list-1', bindingVersion: 1 })
  })

  it('检查范围（输入表）变了才递增 bindingVersion，名称变化不递增', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      {
        id: 8,
        ver: 12,
        sourceId: 430016501,
        name: '本节点',
        tableName: 'sense_data.TB_OLD',
        checkConf: JSON.stringify({ binding: { workflowId: '451', nodeKey: 'web-list-1', bindingVersion: 3 } }),
      },
    ])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})

    await syncMonitorCkSource('430016501', makeMonitorNode(), undefined, options)
    let conf = JSON.parse(String((update.mock.calls[0][0] as Record<string, unknown>).checkConf ?? '{}'))
    // 表从 TB_OLD 变成 TB_JD_SKU_BASE → 范围变化，版本 +1
    expect(conf.binding.bindingVersion).toBe(4)

    // 第二次：表没变、只改名称 → 版本保持
    update.mockClear()
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      {
        id: 8,
        ver: 13,
        sourceId: 430016501,
        name: '本节点',
        tableName: 'sense_data.TB_JD_SKU_BASE',
        checkConf: JSON.stringify({ binding: { workflowId: '451', nodeKey: 'web-list-1', bindingVersion: 4 } }),
      },
    ])
    await syncMonitorCkSource('430016501', makeMonitorNode({ title: '改了名字' }), undefined, options)
    conf = JSON.parse(String((update.mock.calls[0][0] as Record<string, unknown>).checkConf ?? '{}'))
    expect(conf.binding.bindingVersion).toBe(4)
    expect((update.mock.calls[0][0] as Record<string, unknown>).name).toBe('改了名字')
  })

  it('同源多条且都没有 binding 时仍然拒绝（旧记录无法判断改哪一条）', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      { id: 7, sourceId: 430016501, name: '检查项A', checkConf: '{}' },
      { id: 8, sourceId: 430016501, name: '检查项B', checkConf: '{}' },
    ])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck')

    const error = await syncMonitorCkSource('430016501', makeMonitorNode(), undefined, options).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MultipleCkSourceRowsError)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('syncMonitorAlertConfig · C12 绑定认领', () => {
  it('同源多条时只更新绑定到本节点那条，告警配置不再被「多条」挡住', async () => {
    vi.spyOn(ckSourceApi, 'list').mockResolvedValue([
      { id: 7, ver: 11, sourceId: 430016501, name: '别的节点', checkConf: JSON.stringify({ binding: { workflowId: '451', nodeKey: 'web-list-2', bindingVersion: 1 } }) },
      { id: 8, ver: 12, sourceId: 430016501, name: '本节点', tableName: 'sense_data.TB_JD_SKU_BASE', checkConf: JSON.stringify({ binding: { workflowId: '451', nodeKey: 'web-list-1', bindingVersion: 1 }, script: '/code01/keep.py' }) },
    ])
    const update = vi.spyOn(monitorApi, 'updateSourceCheck').mockResolvedValue({})
    const node = makeMonitorNode()

    await syncMonitorAlertConfig('430016501', node, { ...node.alertConfig!, enabled: false }, { workflowId: '451', nodeKey: 'web-list-1' })

    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({ id: 8, ver: 12 })
    const conf = JSON.parse(String(payload.checkConf ?? '{}'))
    // 告警面板只合入告警键，脚本/绑定原样保留；关掉告警即静音 none
    expect(conf.notifyOn).toBe('none')
    expect(conf.script).toBe('/code01/keep.py')
    expect(conf.binding).toMatchObject({ nodeKey: 'web-list-1' })
  })
})
