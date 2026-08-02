import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFlowStore } from './flow'
import { mockFlowRecommend, mockNodeAiChat } from '../api/mock/flows'
import { LIB_GROUPS, NODE_CONFIGS, TEMPLATE_TO_NODE, TEMPLATE_TO_SNATCH, conditionGroupLabel, conditionGroupIsSet, fieldOptionsFromTableOrOutput, collectorCapabilityOf, inferCollectorKind, COLLECTOR_CAPABILITIES } from '@/views/FlowCanvas/canvas/flowModel'
import { makePresetFlowTemplates } from '@/utils/flow/flowTemplates'
import type { Source } from '../api'

describe('flow store 编辑动作', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard') // 载入标准链路（= 公告规则采集 Demo）作为编辑基线
  })

  it('insertAfter 在主链插入节点', () => {
    const before = f.main.length
    f.insertAfter('web-list', 'web')
    expect(f.main.length).toBe(before + 1)
  })

  it('insertAfter(prevId=end) 保持 end 仍在最末（0707 Phase6 修复）', () => {
    f.insertAfter('end', 'web')
    expect(f.main[f.main.length - 1]).toBe('end')
  })

  it('moveTo 重排且保持首尾终端', () => {
    f.moveTo('web-list', 'ai-extract')
    const m = f.main
    expect(m.indexOf('web-list')).toBeGreaterThan(m.indexOf('ai-extract'))
    expect(m[0]).toBe('start')
    expect(m[m.length - 1]).toBe('end')
  })

  it('moveTo 不移动终端节点', () => {
    f.moveTo('start', 'rule')
    expect(f.main[0]).toBe('start')
  })

  it('patchCollect 写入采集配置', () => {
    f.patchCollect('web-list', { url: 'http://new.example' })
    expect(f.configs['web-list'].collectCfg?.url).toBe('http://new.example')
  })

  it('网页抓取节点细分为列表页、详情页、文件附件页', () => {
    expect(f.configs['web-list'].collectCfg?.webKind).toBe('list')
    expect(f.configs['web-detail'].collectCfg?.webKind).toBe('detail')

    f.insertAfter('web-detail', 'web')
    const inserted = f.selectedId
    expect(f.configs[inserted].collectCfg?.webKind).toBe('list')

    f.patchCollect(inserted, { webKind: 'detail' })
    expect(f.configs[inserted].collectCfg?.isDetail).toBe(true)

    f.patchCollect(inserted, { webKind: 'attachment' })
    expect(f.configs[inserted].collectCfg?.isDetail).toBe(false)
  })

  it('附件页取消详情类标记时仍保留附件类型', () => {
    f.patchCollect('web-detail', { webKind: 'attachment' })
    f.patchCollect('web-detail', { isDetail: false })

    expect(f.configs['web-detail'].collectCfg?.webKind).toBe('attachment')
    expect(f.configs['web-detail'].collectCfg?.isDetail).toBe(false)
  })

})

describe('决策条件分支', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('blank')
  })

  it('初始化为一个条件分支，新增分支不使用 ELSE 语义', () => {
    const owner = f.insertAfter('start', 'decision')!
    const group = f.branchGroups.find((item) => item.ownerId === owner)!
    expect(group.branches.map((branch) => branch.label)).toEqual(['条件分支 1'])
    f.addBranch(owner)
    expect(group.branches.map((branch) => branch.label)).toEqual(['条件分支 1', '条件分支 2'])
  })

  it('可删除空条件分支，但至少保留一条', () => {
    const owner = f.insertAfter('start', 'decision')!
    const second = f.addBranch(owner)!
    expect(f.removeBranch(owner, second.id)).toEqual({ ok: true })
    const only = f.branchGroups.find((item) => item.ownerId === owner)!.branches[0]
    expect(f.removeBranch(owner, only.id).ok).toBe(false)
  })
})

describe('两个独立采集节点 + 能力模型（0711 R7/R8）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('节点库存在浏览器抓取/公众号抓取，且能插入主链并解析出各自的固定能力', () => {
    const flat = LIB_GROUPS.flatMap((g) => g.items)
    expect(flat.some((i) => i.template === 'browser-html')).toBe(true)
    expect(flat.some((i) => i.template === 'wechat-html')).toBe(true)
    expect(TEMPLATE_TO_NODE['browser-html']).toBe('browser-html-collect')
    expect(TEMPLATE_TO_NODE['wechat-html']).toBe('wechat-html-collect')

    f.insertAfter('web-list', 'browser-html')
    f.insertAfter('web-list', 'wechat-html')
    const browserId = f.main.find((id) => f.configs[id]?.collectCfg?.collectorKind === 'browser_html')!
    const wechatId = f.main.find((id) => f.configs[id]?.collectCfg?.collectorKind === 'wechat_official_html')!
    expect(browserId).toBeTruthy()
    expect(wechatId).toBeTruthy()

    const browserCap = collectorCapabilityOf(f.configs[browserId])!
    const wechatCap = collectorCapabilityOf(f.configs[wechatId])!
    expect(browserCap.outputMode).toBe('fixed')
    expect(wechatCap.outputMode).toBe('fixed')
    // 固定输出表/队列必须不同（两个独立节点，各自的能力键不同）
    expect(browserCap.fixedOutputTable).not.toBe(wechatCap.fixedOutputTable)
    expect(browserCap.fixedQueue).not.toBe(wechatCap.fixedQueue)
    // 种子配置里 outputTable/queue 已按能力预置好
    expect(f.configs[browserId].collectCfg?.outputTable).toBe(browserCap.fixedOutputTable)
    expect(f.configs[wechatId].taskCfg?.queue).toBe(wechatCap.fixedQueue)
  })

  it('inferCollectorKind：旧节点（无 collectorKind 字段）按 snatchType 正确推导', () => {
    expect(inferCollectorKind(NODE_CONFIGS['web-list'].collectCfg)).toBe('web')
    expect(inferCollectorKind(NODE_CONFIGS['app-collect'].collectCfg)).toBe('app')
    expect(inferCollectorKind(undefined)).toBe('web')
  })

  it('两个新节点先做成同构（0711-B 拍板）：除能力键外字段结构一致', () => {
    const browser = NODE_CONFIGS['browser-html-collect']
    const wechat = NODE_CONFIGS['wechat-html-collect']
    expect(Object.keys(browser.collectCfg!).sort()).toEqual(Object.keys(wechat.collectCfg!).sort())
    expect(browser.base.map((r) => r[0])).toEqual(wechat.base.map((r) => r[0]))
  })

  it('COLLECTOR_CAPABILITIES 覆盖全部 CollectorKind，浏览器/公众号支持代理与登录（供 T3 折叠区判断）', () => {
    expect(COLLECTOR_CAPABILITIES.browser_html.supportsProxy).toBe(true)
    expect(COLLECTOR_CAPABILITIES.browser_html.supportsLogin).toBe(true)
    expect(COLLECTOR_CAPABILITIES.wechat_official_html.supportsProxy).toBe(true)
  })

  it('固定产物节点：patchCollect 无法覆盖输出表，store 层是第二道防线（0711 T5）', () => {
    const browserId = f.insertAfter('web-list', 'browser-html')
    const cap = collectorCapabilityOf(f.configs[browserId])!
    f.patchCollect(browserId, { outputTable: 'attacker_table' })
    expect(f.configs[browserId].collectCfg?.outputTable).toBe(cap.fixedOutputTable)
    // 未涉及 outputTable 的 patch 不受影响，正常写入
    f.patchCollect(browserId, { url: 'https://new.example.com' })
    expect(f.configs[browserId].collectCfg?.url).toBe('https://new.example.com')
    expect(f.configs[browserId].collectCfg?.outputTable).toBe(cap.fixedOutputTable)
  })

  it('固定产物节点：patchTaskConfig/setTaskQueue 无法覆盖队列（0711 T5）', () => {
    const wechatId = f.insertAfter('web-list', 'wechat-html')
    const cap = collectorCapabilityOf(f.configs[wechatId])!
    f.setTaskQueue(wechatId, 'attacker_queue')
    expect(f.configs[wechatId].taskCfg?.queue).toBe(cap.fixedQueue)
  })

  it('普通网页抓取节点（queueMode: editable）：队列/输出表可正常编辑，不受固定防线影响', () => {
    const webId = f.insertAfter('web-list', 'web')
    f.patchCollect(webId, { outputTable: 'custom_table_1' })
    f.setTaskQueue(webId, 'custom_queue_1')
    expect(f.configs[webId].collectCfg?.outputTable).toBe('custom_table_1')
    expect(f.configs[webId].taskCfg?.queue).toBe('custom_queue_1')
  })
})

describe('队列默认值 + 节点启停（0710 会议 D1/D5）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('serialize：数据节点未填队列时自动写入默认队列名（不回写内存 store）', () => {
    const dataNodeId = f.main.find((id) => id === 'web-list')!
    f.setTaskQueue(dataNodeId, '')
    const def = f.serialize()
    const q = def.configs[dataNodeId].taskCfg?.queue
    expect(q).toBeTruthy()
    expect(q!.endsWith('_main') || q!.startsWith('queue_') || q!.length > 0).toBe(true)
    // 显式填过的队列不被覆盖
    f.setTaskQueue(dataNodeId, 'my_custom_queue')
    expect(f.serialize().configs[dataNodeId].taskCfg?.queue).toBe('my_custom_queue')
    // 内存 store 不被 serialize 污染：清空后 store 内仍为空
    f.setTaskQueue(dataNodeId, '')
    f.serialize()
    expect(f.configs[dataNodeId].taskCfg?.queue ?? '').toBe('')
  })

  it('setNodeDisabled：启停写入 disabled 并随序列化带出', () => {
    f.setNodeDisabled('web-list', true)
    expect(f.configs['web-list'].disabled).toBe(true)
    expect(f.dirty).toBe(true)
    expect(f.serialize().configs['web-list'].disabled).toBe(true)
    f.setNodeDisabled('web-list', false)
    expect(f.configs['web-list'].disabled).toBe(false)
  })
})

describe('flow store 新建 / 校验（M5.5）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
  })

  it('默认空白画布：仅 开始 / 完成，无业务节点', () => {
    expect(f.main).toEqual(['start', 'end'])
    expect(Object.keys(f.configs).length).toBe(0)
  })

  it("newFlow('standard') 载入标准链路，newFlow('blank') 重置为空白", () => {
    f.newFlow('standard')
    expect(f.main).toContain('web-list')
    expect(f.main).toContain('rule')
    f.newFlow('blank')
    expect(f.main).toEqual(['start', 'end'])
    expect(f.branches.length).toBe(0)
  })

  it('validateFlow：空链路报错', () => {
    expect(f.validateFlow().length).toBeGreaterThan(0)
  })

  it('validateFlow：采集节点缺 URL / 输出表 报错', () => {
    f.newFlow('blank')
    f.insertAfter('start', 'web') // 新插入采集节点的 url / outputTable 默认清空
    const errs = f.validateFlow()
    expect(errs.some((e) => e.includes('源 URL'))).toBe(true)
    expect(errs.some((e) => e.includes('输出表'))).toBe(true)
  })

  it('serialize → load 往返一致', () => {
    f.newFlow('standard')
    const snap = f.serialize()
    f.newFlow('blank')
    f.load(snap)
    expect(f.main).toEqual(snap.main)
    expect(Object.keys(f.configs).sort()).toEqual(Object.keys(snap.configs).sort())
  })

  it('加载历史子源定时策略时迁到首节点运行配置', () => {
    f.newFlow('standard')
    const legacy = f.serialize()
    const source = legacy.source!
    source.scheduleType = '每周'
    source.scheduleTime = '09:30'
    source.weekdays = [1, 3, 5]
    source.cron = '0 30 9 * * 1,3,5'

    f.load(legacy)

    const collect = f.configs['web-list'].collectCfg!
    expect(collect.scheduleType).toBe('每周')
    expect(collect.scheduleTime).toBe('09:30')
    expect(collect.weekdays).toEqual([1, 3, 5])
    expect(collect.cron).toBe('0 30 9 * * 1,3,5')
    const legacyTask = f.configs['web-list'].taskCfg as { scheduleType?: string } | undefined
    expect(legacyTask?.scheduleType).toBeUndefined()
    expect(f.sourceCfg?.scheduleType).toBeUndefined()
  })

  // 0711 R9：URL 参数校验（同步、不查参数库）
  it('validateFlow：普通网页抓取的 URL 参数写在 # 片段里时报错，提示改用浏览器抓取', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'web')
    f.patchCollect(id, { url: 'https://x.com/a#p=$PARAM$_1036', outputTable: 't1' })
    const errs = f.validateFlow()
    expect(errs.some((e) => e.includes('#') && e.includes('浏览器抓取'))).toBe(true)
  })

  it('validateFlow：浏览器抓取节点的 fragment 参数不报错（能读 fragment）', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'browser-html')
    f.patchCollect(id, { url: 'https://x.com/a#p=$PARAM$_1036', urlParamValues: { '1036': 'SUV' } })
    const errs = f.validateFlow()
    expect(errs.some((e) => e.includes('片段'))).toBe(false)
  })

  it('validateFlow：URL 引用的参数未选取值时报错；选完后不再报错', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'web')
    f.patchCollect(id, { url: 'https://x.com?s=$PARAM$_1036', outputTable: 't1', urlParamRefs: ['1036'] })
    expect(f.validateFlow().some((e) => e.includes('1036') && e.includes('取值'))).toBe(true)
    f.patchCollect(id, { urlParamValues: { '1036': 'SUV' } })
    expect(f.validateFlow().some((e) => e.includes('1036') && e.includes('取值'))).toBe(false)
  })

  it('validateFlow：URL token 必须先绑定到节点参数配置', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'web')
    f.patchCollect(id, { url: 'https://x.com?s=$PARAM$_1036', outputTable: 't1', urlParamValues: { '1036': 'SUV' } })
    expect(f.validateFlow().some((e) => e.includes('1036') && e.includes('未绑定'))).toBe(true)

    f.patchCollect(id, { urlParamRefs: ['1036'] })
    expect(f.validateFlow().some((e) => e.includes('1036') && e.includes('未绑定'))).toBe(false)
  })
})

describe('全节点落库口径（优化 0701 问题二）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('标准链路的非采集数据类节点回填上游输出表', () => {
    // web-detail 落 2101001 → ai-extract / rule 继承；旁路 check 取锚点 ai-extract 的表
    expect(f.configs['ai-extract'].outputTable).toBe('2101001')
    expect(f.configs['rule'].outputTable).toBe('2101001')
    expect(f.configs['check'].outputTable).toBe('2101001')
    // 邮件为通知类，不落表
    expect(f.configs['mail'].outputTable).toBeUndefined()
  })

  it('拖入非采集数据类节点默认继承上游节点的输出表', () => {
    f.insertAfter('web-detail', 'clean')
    const inserted = f.selectedId
    expect(f.configs[inserted].outputTable).toBe('2101001')
  })

  it('validateFlow：数据类节点缺输出表报错，通知/逻辑控制类不报', () => {
    f.newFlow('blank')
    f.insertAfter('start', 'clean') // 无上游可继承 → 缺输出表
    const cleanId = f.selectedId
    f.insertAfter(cleanId, 'mail') // 通知类不要求输出表
    f.insertAfter(cleanId, 'decision') // 逻辑控制不要求输出表
    const errs = f.validateFlow()
    expect(errs.filter((e) => e.includes('缺少输出表')).length).toBe(1)
    // 选上表后不再报缺表
    f.setOutputTable(cleanId, '2101001')
    expect(f.validateFlow().filter((e) => e.includes('缺少输出表')).length).toBe(0)
  })
})

describe('节点输入表 + 任务队列（优化 0701 问题五）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('主链首节点无输入表，其余节点自动继承上一个有输出表的节点', () => {
    expect(f.isFirstMainNodeId('web-list')).toBe(true)
    expect(f.effectiveInputTableFor('web-list')).toBe('')
    expect(f.isFirstMainNodeId('web-detail')).toBe(false)
    expect(f.effectiveInputTableFor('web-detail')).toBe(f.configs['web-list'].collectCfg?.outputTable)
    // ai-extract 无自身输出表变化，继承 web-detail 的输出表
    expect(f.effectiveInputTableFor('ai-extract')).toBe(f.configs['web-detail'].collectCfg?.outputTable)
  })

  it('旁路节点的输入表继承锚点节点的输出表', () => {
    // check 是旁路节点，锚点为 ai-extract（见 makeStandardFlow branches 定义）
    expect(f.effectiveInputTableFor('check')).toBe(f.configs['ai-extract'].outputTable)
  })

  it('setInputTable 显式覆盖后不再跟随上游自动继承', () => {
    f.setInputTable('rule', '9999999')
    expect(f.effectiveInputTableFor('rule')).toBe('9999999')
    // 清空覆盖后恢复自动继承
    f.setInputTable('rule', '')
    expect(f.effectiveInputTableFor('rule')).toBe(f.configs['web-detail'].collectCfg?.outputTable)
  })

  it('patchCollect 可写入采集节点的输入表；setTaskQueue 写入任务配置（0706 调整4：队列归属统一收在 taskCfg）', () => {
    f.patchCollect('web-detail', { inputTable: '888888' })
    f.setTaskQueue('web-detail', 'my_queue')
    expect(f.configs['web-detail'].collectCfg?.inputTable).toBe('888888')
    expect(f.configs['web-detail'].taskCfg?.queue).toBe('my_queue')
  })

  it('任务参数取值只允许引用当前节点自己的 URL 参数，不继承上游节点参数', () => {
    f.patchCollect('web-list', { urlParamRefs: ['p-page'] })
    f.patchCollect('web-detail', { urlParamRefs: ['p-fundcode'] })
    f.patchTaskConfig('web-detail', {
      paramValues: [
        { paramId: 'p-page', fieldId: 'page', valueExpr: '' },
        { paramId: 'p-fundcode', fieldId: 'fund_code', valueExpr: 'trim($VAL$)' },
      ],
    })
    expect(f.configs['web-detail'].taskCfg?.paramValues).toEqual([
      { paramId: 'p-fundcode', fieldId: 'fund_code', valueExpr: 'trim($VAL$)' },
    ])

    const legacy = f.serialize()
    delete legacy.configs['web-detail'].taskCfg!.paramValues
    legacy.configs['web-detail'].taskCfg!.paramRefs = ['p-page', 'p-fundcode']
    f.load(legacy)
    expect(f.configs['web-detail'].taskCfg?.paramValues).toEqual([
      { paramId: 'p-fundcode', fieldId: '', valueExpr: '' },
    ])
    expect(f.configs['web-detail'].taskCfg?.paramRefs).toBeUndefined()
  })

  it('校验会拦截任务参数跨节点引用和未配置取值', () => {
    f.patchCollect('web-list', { urlParamRefs: ['p-page'] })
    f.patchCollect('web-detail', { urlParamRefs: ['p-fundcode'] })
    f.configs['web-detail'].taskCfg = {
      ...f.configs['web-detail'].taskCfg,
      queue: '',
      urlRule: '',
      paramValues: [{ paramId: 'p-page', fieldId: 'page', valueExpr: '' }],
    }
    expect(f.validateFlow()).toContain('「公告详情抓取」任务参数 p-page 未绑定到当前节点')
    expect(f.validateFlow()).toContain('「公告详情抓取」任务参数 p-fundcode 缺少取值字段或值函数')
  })

  it('首节点不保存任务参数、上下文来源和出参列', () => {
    f.patchCollect('web-list', { urlParamRefs: ['p-page'] })
    f.patchTaskConfig('web-list', {
      paramValues: [{ paramId: 'p-page', fieldId: 'page', valueExpr: '' }],
      contextMap: ['title'],
      outColumns: ['detail_url'],
    })
    expect(f.configs['web-list'].taskCfg).not.toHaveProperty('paramValues')
    expect(f.configs['web-list'].taskCfg).not.toHaveProperty('contextMap')
    expect(f.configs['web-list'].taskCfg).not.toHaveProperty('outColumns')
  })

  it('输入表字段选项：实体表缺失时回退到上游产物字段', () => {
    const options = fieldOptionsFromTableOrOutput(
      'TEMP_DETAIL',
      [{ tableId: '2101001', fields: [{ prop: 'title', desc: '标题' }] }],
      [
        { name: 'detail_url', type: 'url', desc: '详情链接' },
        { name: 'publish_time', type: 'date', desc: '发布时间' },
      ],
    )

    expect(options).toEqual([
      { prop: 'detail_url', desc: '详情链接' },
      { prop: 'publish_time', desc: '发布时间' },
    ])
  })

  it('validateFlow：链路断裂导致非首节点无输入表可继承时报错', () => {
    f.newFlow('blank')
    f.insertAfter('start', 'clean')
    const firstId = f.selectedId
    f.setOutputTable(firstId, '2101001')
    f.insertAfter(firstId, 'clean')
    const secondId = f.selectedId
    expect(f.validateFlow().some((e) => e.includes('缺少输入表'))).toBe(false)
    // 打断链路：清空首节点输出表，第二个节点无上游可继承
    f.setOutputTable(firstId, '')
    const errs = f.validateFlow()
    expect(errs.some((e) => e.includes(`「${f.configs[secondId].title}」缺少输入表`))).toBe(true)
  })

  it('buildSourceSeed：接口 Step.inputTable 首步 "-" 映射为无，次步映射为真实表', () => {
    const source = { sourceId: 's1', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const steps = [
      { stepId: 'st1', sourceId: 's1', name: '列表抓取', inputTable: '-', outputTable: 'T1', enabled: true },
      { stepId: 'st2', sourceId: 's1', name: '详情解析', inputTable: 'T1', outputTable: 'T2', enabled: true },
    ] as never
    f.loadFromSource(source, steps)
    expect(f.configs['st1'].collectCfg?.inputTable).toBe('')
    expect(f.configs['st2'].collectCfg?.inputTable).toBe('T1')
  })

  it('参数源（0721 会议 T5）：空白画布新建的首个采集节点带出 urlTemplate，$PARAM$_id 自动识别为 urlParamRefs', () => {
    const source = {
      sourceId: 's-param', name: '参数源测试', url: '', mainTable: 'T1',
      kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913-$PARAM$_912',
      paramRefs: [{ paramId: '913', group: null }, { paramId: '912', group: null }],
    } as never
    f.loadFromSource(source, [] as never) // 新源无 step，画布仍是 start/end 空白
    expect(f.main).toEqual(['start', 'end'])

    const firstId = f.insertAfter('start', 'web')!
    expect(f.configs[firstId].collectCfg?.url).toBe('http://base-$PARAM$_913-$PARAM$_912')
    expect(f.configs[firstId].collectCfg?.urlParamRefs).toEqual(['913', '912'])

    // 非首节点（画布已不是空白 start/end）不套用同一模板，避免详情页等其他节点被误覆盖
    const secondId = f.insertAfter(firstId, 'web')!
    expect(f.configs[secondId].collectCfg?.url).toBe('')
    expect(f.configs[secondId].collectCfg?.urlParamRefs ?? []).toEqual([])
  })

  it('普通源（kind 非 param）新建首个采集节点 URL 仍为空，不受此逻辑影响', () => {
    const source = { sourceId: 's-normal', name: '普通源', url: '', mainTable: 'T1' } as never
    f.loadFromSource(source, [] as never)
    const firstId = f.insertAfter('start', 'web')!
    expect(f.configs[firstId].collectCfg?.url).toBe('')
  })
})

describe('节点参数结构化（0707 Phase 7A）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('标准模板的输入映射、参数、产物使用结构化对象', () => {
    expect(f.configs['web-list'].inmap[0]).toEqual({ name: 'page', from: '序列参数', desc: '1..20' })
    expect(f.configs['web-list'].params[0]).toEqual({ name: 'page', type: 'sequence', desc: '1..20' })
    expect(f.configs['web-list'].output[0]).toEqual({ name: 'detail_url', type: 'url', desc: '详情页子步骤入口' })
  })

  it('旧 tuple 流程加载后自动迁移，序列化只写结构化对象', () => {
    const legacy = JSON.parse(JSON.stringify(f.serialize())) as ReturnType<typeof f.serialize>
    legacy.configs['web-list'].inmap = [['legacy_in', 'legacy_from', 'legacy_desc']] as never
    legacy.configs['web-list'].params = [['legacy_param', 'string', '参数说明']] as never
    legacy.configs['web-list'].output = [['legacy_out', 'json', '产物说明']] as never

    f.load(legacy)
    const snap = f.serialize()

    expect(snap.configs['web-list'].inmap[0]).toEqual({ name: 'legacy_in', from: 'legacy_from', desc: 'legacy_desc' })
    expect(snap.configs['web-list'].params[0]).toEqual({ name: 'legacy_param', type: 'string', desc: '参数说明' })
    expect(snap.configs['web-list'].output[0]).toEqual({ name: 'legacy_out', type: 'json', desc: '产物说明' })
    expect(Array.isArray(snap.configs['web-list'].output[0])).toBe(false)
  })

  it('三列表格编辑 API 写入结构化字段', () => {
    f.setTripleCell('rule', 'params', 0, 0, 'minLength')
    f.setTripleCell('rule', 'params', 0, 1, 'number')
    f.setTripleCell('rule', 'params', 0, 2, '最小正文长度')
    expect(f.configs['rule'].params[0]).toEqual({ name: 'minLength', type: 'number', desc: '最小正文长度' })

    f.addTripleRow('rule', 'inmap')
    const last = f.configs['rule'].inmap.at(-1)
    expect(last).toEqual({ name: '', from: '', desc: '' })
  })
})

describe('规则编排配置（0707 Phase 9）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('规则节点的编排配置可序列化往返', () => {
    f.patchRuleConfig('rule', {
      mode: 'new',
      describe: 'content 中包含地产二字时，tags 返回房地产',
      systemPrompt: '生成 Python 脚本，返回 JSON',
      script: 'def main(content):\n    return {"tags": ["房地产"]}',
      scriptPath: '/rules/generated/rule-001.py',
    })

    const snap = f.serialize()
    f.newFlow('blank')
    f.load(JSON.parse(JSON.stringify(snap)))

    expect(f.configs.rule.ruleCfg).toMatchObject({
      mode: 'new',
      describe: 'content 中包含地产二字时，tags 返回房地产',
      scriptPath: '/rules/generated/rule-001.py',
    })
  })

  it('旧规则节点缺少 ruleCfg 时仍可加载', () => {
    const legacy = JSON.parse(JSON.stringify(f.serialize())) as ReturnType<typeof f.serialize>
    delete legacy.configs.rule.ruleCfg

    expect(() => f.load(legacy)).not.toThrow()
    expect(f.configs.rule.title).toBe('规则引擎处理')
  })
})

// 0801 方案 §9.1/§9.2：规则处理节点走独立发布门禁，不套用其他数据节点「缺少输出表」的通用检查
// （规则节点默认输出表=输入表，NodeConfig.outputTable 留空是正常状态）。
describe('validateFlow：规则处理节点发布门禁（0801 方案 §9.1）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('未保存业务规则（无 ruleId）：报「尚未保存业务规则」，不报「缺少输出表」', () => {
    const errs = f.validateFlow()
    expect(errs).toContain('「规则引擎处理」尚未保存业务规则')
    expect(errs.some((e) => e.includes('规则引擎处理') && e.includes('缺少输出表'))).toBe(false)
  })

  it('有 ruleId 但字段/脚本不全：分别报缺入参、缺出参、未生成脚本', () => {
    f.patchRuleConfig('rule', { mode: 'ref', ruleId: 'orch-1', inputFields: [], outputFields: [], script: '' })
    const errs = f.validateFlow()
    expect(errs).toContain('「规则引擎处理」缺少入参字段')
    expect(errs).toContain('「规则引擎处理」缺少出参字段')
    expect(errs).toContain('「规则引擎处理」尚未生成规则脚本')
    expect(errs).not.toContain('「规则引擎处理」尚未保存业务规则')
  })

  it('ruleId + 入参 + 出参 + 脚本齐全：不报任何规则相关错误', () => {
    f.patchRuleConfig('rule', {
      mode: 'ref', ruleId: 'orch-1', inputFields: ['sku_id'], outputFields: ['sku_name'],
      script: 'def main(sku_id):\n    return {"sku_name": sku_id}',
    })
    const errs = f.validateFlow()
    expect(errs.some((e) => e.includes('规则引擎处理'))).toBe(false)
  })

  it('规则节点已停用：跳过校验', () => {
    f.toggleDisabled('rule')
    const errs = f.validateFlow()
    expect(errs.some((e) => e.includes('规则引擎处理'))).toBe(false)
  })
})

describe('分支段（0707 Phase6）+ 节点进入条件兼容加载', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('加载兼容：采集节点保留 entryCondition 字段', () => {
    const legacy = JSON.parse(JSON.stringify(f.serialize())) as ReturnType<typeof f.serialize>
    legacy.configs['web-detail'].collectCfg = {
      ...legacy.configs['web-detail'].collectCfg!,
      entryCondition: { logic: 'AND', items: [{ field: 'title', op: 'contains', value: '证券' }] },
    }
    expect(() => f.load(legacy)).not.toThrow()
    expect(f.configs['web-detail'].collectCfg?.entryCondition).toEqual({ logic: 'AND', items: [{ field: 'title', op: 'contains', value: '证券' }] })
  })

  it('加载兼容：非采集节点保留 entryCondition 字段', () => {
    const legacy = JSON.parse(JSON.stringify(f.serialize())) as ReturnType<typeof f.serialize>
    legacy.configs['rule'] = { ...legacy.configs['rule'], entryCondition: { logic: 'AND', items: [{ field: 'risk_level', op: 'eq', value: 'high' }] } }
    expect(() => f.load(legacy)).not.toThrow()
    expect(f.configs.rule.entryCondition).toEqual({ logic: 'AND', items: [{ field: 'risk_level', op: 'eq', value: 'high' }] })
  })

  it('可以更新采集节点进入条件', () => {
    f.setEntryCondition('web-detail', { logic: 'AND', items: [{ field: 'title-K2', op: 'contains', value: '财经' }] })
    expect(f.configs['web-detail'].collectCfg?.entryCondition).toEqual({ logic: 'AND', items: [{ field: 'title-K2', op: 'contains', value: '财经' }] })
    f.setEntryCondition('web-detail', undefined)
    expect(f.configs['web-detail'].collectCfg?.entryCondition).toBeUndefined()
  })

  it('branchGroups 默认空数组，序列化往返无损', () => {
    expect(f.branchGroups).toEqual([])
    const def = f.serialize()
    expect(def.branchGroups).toEqual([])
    f.load(JSON.parse(JSON.stringify(def)))
    expect(f.branchGroups).toEqual([])
  })

  it('branchGroups 非空时序列化往返：每个分支的 label/condition/chain 全部保留', () => {
    f.branchGroups.push({
      ownerId: 'decision',
      branches: [
        { id: 'b-if', label: 'IF 命中', condition: { logic: 'AND', items: [{ field: 'status', op: 'eq', value: 'C' }] }, chain: ['ai-extract'] },
        { id: 'b-else', label: 'ELSE 兜底', condition: undefined, chain: [] },
      ],
    })
    const def = f.serialize()
    f.newFlow('blank')
    f.load(JSON.parse(JSON.stringify(def)))
    expect(f.branchGroups).toHaveLength(1)
    expect(f.branchGroups[0].ownerId).toBe('decision')
    expect(f.branchGroups[0].branches).toHaveLength(2)
    expect(f.branchGroups[0].branches[0].label).toBe('IF 命中')
    expect(f.branchGroups[0].branches[0].chain).toEqual(['ai-extract'])
    expect(f.branchGroups[0].branches[1].condition).toBeUndefined()
  })

  it('conditionGroupLabel 多字段 AND/OR 展示（Phase 6 重构后仅给分支条件使用）', () => {
    expect(
      conditionGroupLabel({ logic: 'AND', items: [{ field: 'title', op: 'contains', value: '证券' }, { field: 'amount', op: 'gt', value: '100' }] }, (f) => `字段${f}`),
    ).toBe('字段title 包含 "证券" 且 字段amount 大于 "100"')
    expect(
      conditionGroupLabel({ logic: 'OR', items: [{ field: 'k1', op: 'eq', value: 'a' }, { field: 'k2', op: 'eq', value: 'b' }] }),
    ).toBe('k1 等于 "a" 或 k2 等于 "b"')
    expect(conditionGroupLabel(undefined)).toBe('')
    expect(conditionGroupLabel({ logic: 'AND', items: [] })).toBe('')
  })

  it('conditionGroupLabel/conditionGroupIsSet 表达式模式（0707 优化·补）：直接展示原表达式，判空看 expr 而非 items', () => {
    expect(conditionGroupLabel({ mode: 'expr', logic: 'AND', items: [], expr: '  status = "C"  ' })).toBe('status = "C"')
    expect(conditionGroupLabel({ mode: 'expr', logic: 'AND', items: [], expr: '' })).toBe('')
    expect(conditionGroupIsSet({ mode: 'expr', logic: 'AND', items: [], expr: 'a > 1' })).toBe(true)
    expect(conditionGroupIsSet({ mode: 'expr', logic: 'AND', items: [], expr: '   ' })).toBe(false)
    expect(conditionGroupIsSet({ mode: 'fields', logic: 'AND', items: [{ field: 'k', op: 'eq', value: 'v' }] })).toBe(true)
    expect(conditionGroupIsSet(undefined)).toBe(false)
  })
})

describe('决策/分头分支段 store 操作（0707 Phase6·6.2）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('blank')
  })

  it('insertAfter(decision)：自动创建默认条件分支', () => {
    const id = f.insertAfter('start', 'decision')
    expect(f.configs[id].kind).toBe('decision')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)
    expect(g).toBeDefined()
    expect(g!.branches).toHaveLength(1)
    expect(g!.branches[0].label).toBe('条件分支 1')
  })

  it('insertAfter(parallel)：自动创建路径A + 路径B 两条分支', () => {
    const id = f.insertAfter('start', 'parallel')
    expect(f.configs[id].kind).toBe('parallel')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)
    expect(g).toBeDefined()
    expect(g!.branches).toHaveLength(2)
    expect(g!.branches[0].label).toBe('路径A')
    expect(g!.branches[1].label).toBe('路径B')
  })

  it('ensureBranchGroup：已有则不覆盖', () => {
    const id = f.insertAfter('start', 'decision')
    const g1 = f.ensureBranchGroup(id, 'decision')
    expect(g1?.branches).toHaveLength(1)
    // 再调一次，branches 数量不变
    f.ensureBranchGroup(id, 'decision')
    expect(f.branchGroups.find((bg) => bg.ownerId === id)?.branches).toHaveLength(1)
  })

  it('addBranch(决策)：追加独立条件分支', () => {
    const id = f.insertAfter('start', 'decision')
    const elif = f.addBranch(id)
    expect(elif?.label).toBe('条件分支 2')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    expect(g.branches.map((b) => b.label)).toEqual(['条件分支 1', '条件分支 2'])
    // 再加一条
    const elif2 = f.addBranch(id)
    expect(elif2?.label).toBe('条件分支 3')
    expect(g.branches.map((b) => b.label)).toEqual(['条件分支 1', '条件分支 2', '条件分支 3'])
  })

  it('addBranch(分头节点)：拒绝', () => {
    const id = f.insertAfter('start', 'parallel')
    expect(f.addBranch(id)).toBeNull()
  })

  it('removeBranch(唯一条件分支)：拒绝', () => {
    const id = f.insertAfter('start', 'decision')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    expect(f.removeBranch(id, g.branches[0].id)).toEqual({ ok: false, reason: '至少保留 1 条分支' })
  })

  it('removeBranch(只剩 2 条)：拒绝', () => {
    const id = f.insertAfter('start', 'parallel')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    expect(f.removeBranch(id, g.branches[0].id)).toEqual({ ok: false, reason: '至少保留 2 条分支' })
  })

  it('removeBranch(chain 非空)：拒绝', () => {
    const id = f.insertAfter('start', 'decision')
    const child = f.insertAfter(id, 'web')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    g.branches[0].chain.push(child)
    expect(f.removeBranch(id, g.branches[0].id)).toEqual({ ok: false, reason: '分支内还有 1 个节点，请先移除' })
  })

  it('insertInBranch：默认追加到末尾；指定 index 插入；重复挂载拒绝', () => {
    const id = f.insertAfter('start', 'decision')
    const n1 = f.insertAfter('start', 'web')
    const n2 = f.insertAfter('start', 'web')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    const ifBranch = g.branches[0]
    expect(f.insertInBranch(id, ifBranch.id, n1)).toBe(true)
    expect(ifBranch.chain).toEqual([n1])
    expect(f.insertInBranch(id, ifBranch.id, n2, 0)).toBe(true)
    expect(ifBranch.chain).toEqual([n2, n1])
    // 重复挂载
    expect(f.insertInBranch(id, ifBranch.id, n1)).toBe(false)
    expect(ifBranch.chain).toEqual([n2, n1])
  })

  it('moveInBranch：上下移边界', () => {
    const id = f.insertAfter('start', 'decision')
    const n1 = f.insertAfter('start', 'web')
    const n2 = f.insertAfter('start', 'web')
    const n3 = f.insertAfter('start', 'web')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    const br = g.branches[0]
    f.insertInBranch(id, br.id, n1)
    f.insertInBranch(id, br.id, n2)
    f.insertInBranch(id, br.id, n3)
    expect(br.chain).toEqual([n1, n2, n3])
    // 中间上移
    expect(f.moveInBranch(id, br.id, 1, 'up')).toBe(true)
    expect(br.chain).toEqual([n2, n1, n3])
    // 顶端上移拒绝
    expect(f.moveInBranch(id, br.id, 0, 'up')).toBe(false)
    // 底端下移拒绝
    expect(f.moveInBranch(id, br.id, 2, 'down')).toBe(false)
  })

  it('moveBranch：移动分支顺序，不误动分支内 chain 节点', () => {
    const id = f.insertAfter('start', 'decision')
    f.addBranch(id)
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    const [ifBranch, elifBranch] = g.branches
    const n1 = f.insertAfter('start', 'web')
    const n2 = f.insertAfter('start', 'web')
    f.insertInBranch(id, elifBranch.id, n1)
    f.insertInBranch(id, elifBranch.id, n2)

    expect(f.moveBranch(id, elifBranch.id, 'up')).toBe(true)

    expect(g.branches.map((b) => b.id)).toEqual([elifBranch.id, ifBranch.id])
    expect(elifBranch.chain).toEqual([n1, n2])
  })

  it('setBranchCondition：每条条件分支均可设置条件', () => {
    const id = f.insertAfter('start', 'decision')
    f.addBranch(id)
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    const secondId = g.branches[1].id
    expect(f.setBranchCondition(id, secondId, { logic: 'AND', items: [] })).toBe(true)
  })

  it('setBranchCondition(IF)：可设；setBranchLabel：可改名', () => {
    const id = f.insertAfter('start', 'decision')
    const g = f.branchGroups.find((bg) => bg.ownerId === id)!
    expect(f.setBranchCondition(id, g.branches[0].id, { logic: 'AND', items: [{ field: 'k', op: 'eq', value: 'v' }] })).toBe(true)
    expect(g.branches[0].condition?.items[0].value).toBe('v')
    expect(f.setBranchLabel(id, g.branches[0].id, 'IF 命中')).toBe(true)
    expect(g.branches[0].label).toBe('IF 命中')
  })

  it('remove(决策 owner)：级联删除整组 FlowBranchGroup + chain 内节点', () => {
    const owner = f.insertAfter('start', 'decision')
    const child = f.insertAfter('start', 'web')
    f.insertInBranch(owner, f.branchGroups[0].branches[0].id, child)
    expect(f.configs[child]).toBeDefined()
    expect(f.branchGroups).toHaveLength(1)
    f.remove(owner)
    // owner 整组没了
    expect(f.branchGroups).toHaveLength(0)
    // child 从 configs 摘除（chain 内的节点被清理）
    expect(f.configs[child]).toBeUndefined()
  })

  it('remove(branch chain 内节点)：从 chain 摘除 + delete configs（与 main/BranchSeed 行为一致）', () => {
    const owner = f.insertAfter('start', 'decision')
    const child = f.insertAfter('start', 'web')
    f.insertInBranch(owner, f.branchGroups[0].branches[0].id, child)
    f.remove(child)
    // 不论节点在哪（main/BranchSeed/chain），remove 都 delete configs（统一策略）
    expect(f.configs[child]).toBeUndefined()
    // chain 同步摘除（防止悬挂引用）
    const g = f.branchGroups.find((bg) => bg.ownerId === owner)!
    expect(g.branches[0].chain).not.toContain(child)
  })

  it('validateFlow：决策节点缺条件时拦截（0707 Phase6 6.6）', () => {
    const owner = f.insertAfter('start', 'decision')
    const errs = f.validateFlow()
    expect(errs).toContain(`「${f.configs[owner].title}」第 1 条分支（条件分支 1）缺少条件`)
  })

  it('validateFlow：决策节点条件完整时通过（0707 Phase6 6.6）', () => {
    const owner = f.insertAfter('start', 'decision')
    f.setBranchCondition(owner, f.branchGroups[0].branches[0].id, { logic: 'AND', items: [{ field: 'k', op: 'eq', value: 'v' }] })
    const errs = f.validateFlow()
    expect(errs).not.toContain(`「${f.configs[owner].title}」第 1 条分支（条件分支 1）缺少条件`)
  })

  it('validateFlow：表达式模式空表达式仍拦截；非空表达式通过（0707 优化·补·表达式模式）', () => {
    const owner = f.insertAfter('start', 'decision')
    f.setBranchCondition(owner, f.branchGroups[0].branches[0].id, { mode: 'expr', logic: 'AND', items: [], expr: '' })
    expect(f.validateFlow()).toContain(`「${f.configs[owner].title}」第 1 条分支（条件分支 1）缺少条件`)

    f.setBranchCondition(owner, f.branchGroups[0].branches[0].id, { mode: 'expr', logic: 'AND', items: [], expr: 'status = "C"' })
    expect(f.validateFlow()).not.toContain(`「${f.configs[owner].title}」第 1 条分支（条件分支 1）缺少条件`)
  })

  it('validateFlow：chain 节点也走主链节点同套校验（缺输出表则拦截）', () => {
    const owner = f.insertAfter('start', 'decision')
    f.setBranchCondition(owner, f.branchGroups[0].branches[0].id, { logic: 'AND', items: [{ field: 'k', op: 'eq', value: 'v' }] })
    // 插一个 clean 类节点到 IF 分支（clean 不产数据行 → 不要求输出表）→ 选一个数据节点
    const child = f.insertAfter('start', 'web')
    // web 是采集类，缺 url / outputTable 应拦截（即使挂在 chain 里）
    f.insertInBranch(owner, f.branchGroups[0].branches[0].id, child)
    const errs = f.validateFlow()
    expect(errs.some((e) => e.includes('缺少源 URL'))).toBe(true)
  })

  it('addNodeToBranch：挂进 chain 末尾；输出表自动继承 owner 的有效输入表（0707 Phase6·补·6.4）', () => {
    // owner（决策）插在 web-list 之后：owner 自己不产表，chain 首节点应递归继承到 web-list 的输出表
    const listId = f.insertAfter('start', 'web')
    f.setOutputTable(listId, '2101001')
    const owner = f.insertAfter(listId, 'decision')
    const ifBranchId = f.branchGroups[0].branches[0].id
    const newId = f.addNodeToBranch(owner, ifBranchId, 'parse')
    expect(newId).not.toBeNull()
    expect(f.branchGroups[0].branches[0].chain).toEqual([newId])
    expect(f.configs[newId!].outputTable).toBe('2101001')
    expect(f.effectiveInputTableFor(newId!)).toBe('2101001')
  })

  it('addNodeToBranch：链内第二个节点继承链内前一个节点的输出表，而非重新回退到 owner', () => {
    const owner = f.insertAfter('start', 'decision')
    const branchId = f.branchGroups[0].branches[0].id
    const n1 = f.addNodeToBranch(owner, branchId, 'parse')!
    f.setOutputTable(n1, 'PARSE_TB')
    const n2 = f.addNodeToBranch(owner, branchId, 'map')!
    expect(f.branchGroups[0].branches[0].chain).toEqual([n1, n2])
    expect(f.effectiveInputTableFor(n2)).toBe('PARSE_TB')
  })

  it('addNodeToBranch：拒绝往 chain 里塞决策/分头模板（防嵌套分支）', () => {
    const owner = f.insertAfter('start', 'decision')
    const branchId = f.branchGroups[0].branches[0].id
    expect(f.addNodeToBranch(owner, branchId, 'decision')).toBeNull()
    expect(f.addNodeToBranch(owner, branchId, 'parallel')).toBeNull()
    expect(f.branchGroups[0].branches[0].chain).toEqual([])
  })

  it('addNodeToBranch：ownerId/branchId 不存在时拒绝', () => {
    expect(f.addNodeToBranch('ghost-owner', 'ghost-branch', 'web')).toBeNull()
  })
})

describe('fan-in 收拢线渲染（0707 Phase6·6.4 补）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('blank')
  })

  it('决策分支列末节点 -> 汇合点收拢线存在；owner->汇合 的主链直线被跳过（不再穿过 fan-out）', () => {
    const owner = f.insertAfter('start', 'decision')
    const ifBranchId = f.branchGroups[0].branches[0].id
    const child = f.addNodeToBranch(owner, ifBranchId, 'web')!
    const merge = f.insertAfter(owner, 'web') // owner 的下一个主链节点 = 汇合点

    const layout = f.layout
    // owner->汇合点 主链直线被跳过（不再笔直穿过 fan-out 区域与分支列重叠）
    expect(layout.mainEdges.every((e) => e.fromId !== owner)).toBe(true)

    // fan-in 收拢线：从 IF 列末节点底部中心 -> 汇合点顶部中心（CENTER=320）
    const childNode = layout.nodes.find((n) => n.id === child)!
    const mergeNode = layout.nodes.find((n) => n.id === merge)!
    const colX = layout.fanOutColMeta[owner].branches[0].colX
    const lastBottom = childNode.pos.top + childNode.pos.height
    const fanIn = layout.fanOutEdges.find(
      (e) => !e.branchLabel && e.d.startsWith(`M${colX} ${lastBottom}`) && e.d.endsWith(`320 ${mergeNode.pos.top}`),
    )
    expect(fanIn).toBeDefined()
  })

  it('奇数列（3 分支决策）：中间列落在 CENTER，仍无主链直线穿过 fan-out', () => {
    const owner = f.insertAfter('start', 'decision')
    f.addBranch(owner)
    f.addBranch(owner) // 三条条件分支（奇数）
    expect(f.branchGroups[0].branches).toHaveLength(3)

    const layout = f.layout
    const col = layout.fanOutColMeta[owner]
    expect(col).toBeDefined()
    // 中间列恰在 CENTER=320（=主链直线 x，重叠风险几何存在），跳过直线才不与之中叠
    expect(col.branches[1].colX).toBe(320)
    expect(layout.mainEdges.every((e) => e.fromId !== owner)).toBe(true)
  })
})

describe('源级配置分层（0706 优化·源/节点配置分层）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
  })

  it('标准链路自带演示源配置，源级字段不再出现在节点 collectCfg 上', () => {
    f.newFlow('standard')
    expect(f.sourceCfg?.name).toBe('交易所公告列表 - A 股')
    expect(f.sourceCfg?.needLogin).toBe(true)
    expect((f.configs['web-list'].collectCfg as unknown as Record<string, unknown>).sourceName).toBeUndefined()
  })

  it('空白流程没有源配置；patchSource 懒创建草稿', () => {
    f.newFlow('blank')
    expect(f.sourceCfg).toBeNull()
    f.patchSource({ name: '草稿源' })
    expect(f.sourceCfg?.name).toBe('草稿源')
  })

  it('serialize → load 往返：source 层保留', () => {
    f.newFlow('blank')
    f.patchSource({ name: '草稿源', useProxy: true, tags: ['a', 'b'] })
    const def = f.serialize()
    expect(def.source?.name).toBe('草稿源')
    f.newFlow('standard')
    f.load(JSON.parse(JSON.stringify(def)))
    expect(f.sourceCfg?.name).toBe('草稿源')
    expect(f.sourceCfg?.tags).toEqual(['a', 'b'])
  })

  it('loadFromSource 后 sourceCfg 与 sourceCtx 内容一致', () => {
    const source = { sourceId: 's1', name: '测试源', url: 'http://x', mainTable: 'T1', configId: 'c1', owner: 'a', state: 'C' } as never
    const steps = [{ stepId: 'st1', sourceId: 's1', name: '列表抓取', outputTable: 'T1', enabled: true }] as never
    f.loadFromSource(source, steps)
    expect(f.sourceCfg?.sourceId).toBe('s1')
    expect(f.sourceCtx?.sourceId).toBe('s1')
  })

  it('startDraftSource：空白模板进入有源草稿画布但不自动生成首节点', () => {
    f.startDraftSource({ sourceId: 'draft-1', name: '未命名采集源', url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' })

    expect(f.sourceCtx?.sourceId).toBe('draft-1')
    expect(f.sourceCfg?.sourceId).toBe('draft-1')
    expect(f.main).toEqual(['start', 'end'])
    expect(Object.keys(f.configs)).toEqual([])
  })

  it('startSiteFlow：无存档时为空白画布（0710 回退默认骨架，走空白引导卡模式），id 落 site: 存档位', () => {
    f.startSiteFlow({ siteId: 'site-x', name: '测试网站', category: '测试类', owner: 'admin', sourceCount: 0, errorCount: 0 })

    expect(f.siteCtx?.siteId).toBe('site-x')
    expect(f.flowId).toBe('site:site-x')
    expect(f.main).toEqual(['start', 'end'])
    expect(Object.keys(f.configs)).toEqual([])
  })

  it('startSiteFlow：有存档时优先用存档，不走默认骨架', () => {
    f.startSiteFlow(
      { siteId: 'site-y', name: '测试网站', category: '测试类', owner: 'admin', sourceCount: 0, errorCount: 0 },
      { id: 'site:site-y', name: '已保存模板', version: 'v1', main: ['start', 'end'], branches: [], configs: {}, updatedAt: '' },
    )

    expect(f.main).toEqual(['start', 'end'])
    expect(Object.keys(f.configs)).toEqual([])
  })
})

describe('flow/recommend 意图匹配（M5.5）', () => {
  it('命中「公共网页抓取」关键词', () => {
    const r = mockFlowRecommend({ prompt: '我想做个公共网页数据抓取' })
    expect(r.flow.name).toContain('公共网页')
    expect(r.flow.main.filter((id) => id !== 'start' && id !== 'end').length).toBeGreaterThan(0)
    expect(r.alternatives.length).toBeGreaterThan(0)
  })

  it('按 intent 直选「文件下载解析」', () => {
    const r = mockFlowRecommend({ intent: 'file-parse' })
    expect(r.flow.name).toContain('文件下载解析')
    const fileNodeId = r.flow.main.find((id) => id.includes('web-detail'))
    expect(fileNodeId).toBeTruthy()
    expect(r.flow.configs[fileNodeId!].collectCfg?.webKind).toBe('attachment')
  })

  it('未命中 → 空白流程兜底', () => {
    const r = mockFlowRecommend({ prompt: 'zzz qqq xxx' })
    expect(r.flow.main).toEqual(['start', 'end'])
  })
})

describe('「落表输出」节点移除（优化 0701 问题四）', () => {
  const nodeIds = (main: string[]) => main.filter((id) => id !== 'start' && id !== 'end')

  it('节点库 / 种子 / 模板映射无「落表输出」', () => {
    expect(LIB_GROUPS.flatMap((g) => g.items).some((it) => it.name === '落表输出')).toBe(false)
    expect(NODE_CONFIGS['output']).toBeUndefined()
    expect(TEMPLATE_TO_NODE['output']).toBeUndefined()
  })

  it('公共网页抓取预置链路精简为 列表+详情 两节点', () => {
    const r = mockFlowRecommend({ intent: 'web-public' })
    const ids = nodeIds(r.flow.main)
    expect(ids.length).toBe(2)
    const titles = ids.map((id) => r.flow.configs[id].title)
    expect(titles).toEqual(['网页抓取（列表）', '网页抓取（详情）'])
  })

  it('登录站点 / 文件下载解析链路不再带落表步骤', () => {
    expect(nodeIds(mockFlowRecommend({ intent: 'web-login' }).flow.main).length).toBe(2)
    const fp = mockFlowRecommend({ intent: 'file-parse' })
    const titles = nodeIds(fp.flow.main).map((id) => fp.flow.configs[id].title)
    expect(titles).toEqual(['文件下载', '数据处理'])
  })

  it('数据处理节点是唯一的新增入口，文件下载预置不再引用旧节点类型', () => {
    expect(LIB_GROUPS.map((group) => group.title)).toEqual(expect.not.arrayContaining(['解析结构化', '数据清洗', '数据校验']))
    expect(LIB_GROUPS.find((group) => group.title === '数据处理')?.items).toEqual([
      expect.objectContaining({ template: 'process', name: '数据处理' }),
    ])

    const flow = mockFlowRecommend({ intent: 'file-parse' }).flow
    const titles = nodeIds(flow.main).map((id) => flow.configs[id].title)
    expect(titles).not.toEqual(expect.arrayContaining(['文件解析', '字段抽取']))
  })
})

describe('APP 抓取节点（0707 Phase 8）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('blank')
  })

  it('添加浮层提供 APP 抓取模板，插入后使用 [95] APP 抓取配置', () => {
    const collectGroup = LIB_GROUPS.find((g) => g.title === '采集类')
    expect(collectGroup?.items.some((it) => it.template === 'app' && it.name === 'APP 抓取')).toBe(true)
    expect(TEMPLATE_TO_NODE.app).toBe('app-collect')
    expect(TEMPLATE_TO_SNATCH.app).toBe('[95] - APP 抓取')

    const id = f.insertAfter('start', 'app')
    expect(f.configs[id].title).toBe('APP 抓取')
    expect(f.configs[id].collectCfg?.snatchType).toBe('[95] - APP 抓取')
    expect(f.configs[id].base.some(([label]) => label === '包名')).toBe(true)
  })
})

describe('节点级 AI 对话 mock 回复（优化 0701 问题八）', () => {
  it('节点已停止时优先提示无法处理数据', () => {
    const r = mockNodeAiChat({ question: '为什么试跑失败', nodeTitle: '列表抓取', disabled: true })
    expect(r.reply).toContain('已停止')
  })

  it('命中"失败"关键词给出发起抓取失败排查建议', () => {
    const r = mockNodeAiChat({ question: '为什么发起抓取失败', nodeTitle: '列表抓取' })
    expect(r.reply).toContain('发起抓取失败原因')
  })

  it('命中"队列"关键词解释任务队列口径', () => {
    const r = mockNodeAiChat({ question: '任务队列怎么填', nodeTitle: '规则处理' })
    expect(r.reply).toContain('队列')
  })

  it('命中"配置"关键词时区分是否已绑输出表', () => {
    const withTable = mockNodeAiChat({ question: '这个节点的配置是什么', nodeTitle: '详情解析', outputTable: '2101001' })
    expect(withTable.reply).toContain('2101001')
    const withoutTable = mockNodeAiChat({ question: '这个节点的配置是什么', nodeTitle: '详情解析' })
    expect(withoutTable.reply).toContain('还没有绑定输出表')
  })

  it('未命中关键词时返回通用问候', () => {
    const r = mockNodeAiChat({ question: '你好', nodeTitle: '列表抓取' })
    expect(r.reply).toContain('列表抓取')
  })
})

describe('Task 5 流程模板绑定', () => {
  it('子源序列化时保存模板版本和当前节点动态绑定', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source: Source = {
      sourceId: 'source-template-binding', name: '模板子源', url: 'https://source.example.com', configId: '', mainTable: '', owner: 'tester', state: 'C',
    }
    flow.loadFromSource(source, [])
    const template = makePresetFlowTemplates().find((item) => item.id === 'preset-file-parse')!
    const fileId = template.definition.main.find((id) => id !== 'start' && id !== 'end')!
    flow.applyTemplate(template)
    flow.patchCollect(fileId, { url: 'https://source.example.com/report.pdf', outputTable: 'source_table', urlParamRefs: ['param-a'] })

    const saved = flow.serialize()
    expect(saved.source).toMatchObject({ templateId: template.id, templateVersion: template.version })
    expect(saved.source?.nodeBindings?.[fileId].collect).toMatchObject({
      url: 'https://source.example.com/report.pdf', outputTable: 'source_table', urlParamRefs: ['param-a'],
    })
  })

  it('模板升级清理已删除稳定节点的绑定，不按显示名称复用', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source: Source = {
      sourceId: 'source-template-upgrade', name: '模板升级子源', url: 'https://source.example.com', configId: '', mainTable: '', owner: 'tester', state: 'C',
    }
    flow.loadFromSource(source, [])
    const template = makePresetFlowTemplates().find((item) => item.id === 'preset-file-parse')!
    const fileId = template.definition.main.find((id) => id !== 'start' && id !== 'end')!
    flow.applyTemplate(template)
    flow.patchCollect(fileId, { url: 'https://source.example.com/report.pdf' })
    const upgraded = {
      ...template,
      version: template.version + 1,
      definition: {
        ...template.definition,
        main: template.definition.main.filter((id) => id !== fileId),
        configs: Object.fromEntries(Object.entries(template.definition.configs).filter(([id]) => id !== fileId)),
      },
    }

    const result = flow.applyTemplate(upgraded)
    expect(result?.cleared).toBeGreaterThan(0)
    expect(flow.sourceCfg?.nodeBindings?.[fileId]).toBeUndefined()
  })
})

describe('参数源套模板不冲掉参数配置（0721 会议反馈坐实的真实 bug）', () => {
  it('applyTemplate 后主链首个采集节点重新灌回 urlTemplate / urlParamRefs，源级字段全程不丢', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source: Source = {
      sourceId: 's-param', name: '参数源测试', url: '', configId: '', mainTable: 'T1', owner: 'a', state: 'C',
      kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913-$PARAM$_912',
      paramRefs: [{ paramId: '913', group: null }, { paramId: '912', group: null }],
    }
    flow.loadFromSource(source, [])
    const firstId = flow.insertAfter('start', 'web')!
    expect(flow.configs[firstId].collectCfg?.url).toBe('http://base-$PARAM$_913-$PARAM$_912')

    const template = makePresetFlowTemplates().find((item) => item.id === 'preset-web-public')!
    flow.applyTemplate(template)

    const collectNodeId = flow.main.find((id) => flow.configs[id]?.collectCfg)!
    expect(flow.configs[collectNodeId].collectCfg?.url).toBe('http://base-$PARAM$_913-$PARAM$_912')
    expect(flow.configs[collectNodeId].collectCfg?.urlParamRefs).toEqual(['913', '912'])
    expect(flow.sourceCfg).toMatchObject({
      kind: 'param', urlTemplate: 'http://base-$PARAM$_913-$PARAM$_912',
      paramRefs: [{ paramId: '913', group: null }, { paramId: '912', group: null }],
    })
  })

  it('普通源（非参数源）套模板不受影响，行为不变', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source: Source = { sourceId: 's-normal', name: '普通源', url: 'https://example.com', configId: '', mainTable: 'T1', owner: 'a', state: 'C' }
    flow.loadFromSource(source, [])
    const template = makePresetFlowTemplates().find((item) => item.id === 'preset-web-public')!
    flow.applyTemplate(template)

    const collectNodeId = flow.main.find((id) => flow.configs[id]?.collectCfg)!
    expect(flow.configs[collectNodeId].collectCfg?.urlParamRefs ?? []).toEqual([])
  })
})
