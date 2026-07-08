import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFlowStore } from './flow'
import { mockFlowRecommend, mockNodeAiChat } from '../api/mock/flows'
import { LIB_GROUPS, NODE_CONFIGS, TEMPLATE_TO_NODE, TEMPLATE_TO_SNATCH } from '../views/FlowCanvas/flowModel'

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

  it('任务配置支持多个命名参数并可序列化往返', () => {
    const params = [
      { name: 'detailUrl', field: 'detail_url' },
      { name: 'publishDate', field: 'publish_time' },
    ]

    f.patchTaskConfig('web-detail', { params })
    const snap = f.serialize()
    f.newFlow('blank')
    f.load(JSON.parse(JSON.stringify(snap)))

    expect(f.configs['web-detail'].taskCfg?.params).toEqual(params)
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

describe('节点进入条件（优化 0701 问题十·方案B）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('采集节点：patchCollect 写入 entryCondition，nodeEntryCondition 读取一致', () => {
    f.patchCollect('web-detail', { entryCondition: { logic: 'AND', items: [{ field: 'title', op: 'contains', value: '证券' }] } })
    expect(f.configs['web-detail'].collectCfg?.entryCondition).toEqual({ logic: 'AND', items: [{ field: 'title', op: 'contains', value: '证券' }] })
  })

  it('非采集节点：setEntryCondition 写入 / 清空', () => {
    f.setEntryCondition('rule', { logic: 'AND', items: [{ field: 'risk_level', op: 'eq', value: 'high' }] })
    expect(f.configs['rule'].entryCondition).toEqual({ logic: 'AND', items: [{ field: 'risk_level', op: 'eq', value: 'high' }] })
    f.setEntryCondition('rule', undefined)
    expect(f.configs['rule'].entryCondition).toBeUndefined()
  })

  it('0706 优化：条件组支持多字段 AND/OR 组合', () => {
    f.setEntryCondition('rule', {
      logic: 'AND',
      items: [
        { field: 'k1', op: 'ne', value: '' },
        { field: 'k2', op: 'gt', value: '100' },
      ],
    })
    expect(f.configs['rule'].entryCondition?.items.length).toBe(2)
    expect(f.configs['rule'].entryCondition?.logic).toBe('AND')
  })

  it('序列化（flow.serialize）往返一致：entryCondition 保留', () => {
    const cond = { logic: 'AND' as const, items: [{ field: 'title', op: 'contains' as const, value: '证券' }] }
    f.patchCollect('web-detail', { entryCondition: cond })
    const def = f.serialize()
    expect(def.configs['web-detail'].collectCfg?.entryCondition).toEqual(cond)
    f.load(JSON.parse(JSON.stringify(def)))
    expect(f.configs['web-detail'].collectCfg?.entryCondition).toEqual(cond)
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
    expect(titles).toEqual(['文件下载', '文件解析', '字段抽取'])
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

  it('命中"失败"关键词给出试跑失败排查建议', () => {
    const r = mockNodeAiChat({ question: '为什么试跑失败', nodeTitle: '列表抓取' })
    expect(r.reply).toContain('试跑失败原因')
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
