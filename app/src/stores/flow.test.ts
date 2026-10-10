import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFlowStore } from './flow'
import { mockFlowRecommend, mockNodeAiChat } from '../api/mock/flows'
import { LIB_GROUPS, NODE_CONFIGS, TEMPLATE_TO_NODE, TEMPLATE_TO_SNATCH, conditionGroupLabel, conditionGroupIsSet, fieldOptionsFromTableOrOutput, collectorCapabilityOf, inferCollectorKind, COLLECTOR_CAPABILITIES, buildSourceSeed, isRuleNode, isMonitorNode, isDataValidationNode, iconFor, nodeClassFor, nodeTypeLabel } from '@/views/FlowCanvas/canvas/flowModel'
import { makePresetFlowTemplates } from '@/utils/flow/flowTemplates'
import type { Source, Step } from '../api'

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

  // 2026-09-04 会上提出：新建规则处理 / 数据监控节点时「适用源」默认 -1（= 该配置下所有源）。
  // 2026-09-24 用户拍板扩到**所有类型**：新建节点都不该一上来就锁死在当前源上，
  // 步骤归属靠 mainConfig 锚点，不靠 sourceId。
  it('新建任意类型节点：适用源默认 -1（原来只有规则/监控是 -1，采集类锁死在当前源）', () => {
    f.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [],
    )
    const ruleId = f.insertAfter(f.main[1], 'rule')!
    expect(isRuleNode(f.configs[ruleId])).toBe(true)
    expect(f.configs[ruleId].stepSourceId).toBe('-1')

    // 数据监控复用同一条默认值路径（TEMPLATE_TO_NODE.monitor = 'rule'）
    const monitorId = f.insertAfter(f.main[1], 'monitor')!
    expect(f.configs[monitorId].stepSourceId).toBe('-1')

    // 采集类 / 处理类同样带上 -1（2026-09-24 起不再区分类型）
    expect(f.configs[f.insertAfter(f.main[1], 'web')!].stepSourceId).toBe('-1')
    expect(f.configs[f.insertAfter(f.main[1], 'translate')!].stepSourceId).toBe('-1')
    expect(f.configs[f.insertAfter(f.main[1], 'ocr')!].stepSourceId).toBe('-1')
  })

  it('分支内新增节点：适用源同样默认 -1', () => {
    f.loadFromSource(
      { sourceId: '430016398', name: 'test1', url: 'http://x', configId: '1400917', mainTable: '6200026', owner: 'a', state: 'C' } as never,
      [],
    )
    // 1008-BR-06：分支由普通节点分叉，不再靠决策节点
    const ownerId = f.insertAfter('end', 'web')
    const first = f.insertAfter(ownerId, 'web')
    const siblingId = f.addSibling(first, 'web')!
    expect(f.configs[siblingId].stepSourceId).toBe('-1')
    const group = f.branchGroups.find((bg) => bg.ownerId === ownerId)!
    const branchNodeId = f.addNodeToBranch(ownerId, group.branches[0]!.id, 'web')!
    expect(f.configs[branchNodeId].stepSourceId).toBe('-1')
  })

  it('insertAfter(prevId=end) 保持 end 仍在最末（0707 Phase6 修复）', () => {
    f.insertAfter('end', 'web')
    expect(f.main[f.main.length - 1]).toBe('end')
  })

  it('insertAfter(rule)：按旧「添加后续步骤 → 规则处理」用前置配置 ID 命名，规则 ID 默认 -1，输入表继承上游', () => {
    f.configs['web-list'].configId = '1400979'
    f.configs['web-list'].collectCfg!.outputTable = '900'
    const id = f.insertAfter('web-list', 'rule')!
    expect(f.configs[id].title).toBe('1400979-规则处理')
    expect(f.configs[id].configName).toBe('1400979-规则处理')
    expect(f.configs[id].itemId).toBe('-1')
    expect(f.configs[id].inputTable).toBe('900')
    expect(f.configs[id].ruleCfg?.inputTableId).toBe('900')
    // 规则处理节点不是数据监控节点（template 信号区分）
    expect(f.configs[id].template).toBe('rule')
    expect(isMonitorNode(f.configs[id])).toBe(false)
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
    f.patchCollect('web-list', { url: 'http://new.example', dedupMode: 'table' })
    expect(f.configs['web-list'].collectCfg?.url).toBe('http://new.example')
    expect(f.configs['web-list'].collectCfg?.dedupMode).toBe('table')
  })

  it('setTitle 允许编辑过程暂时清空，流程校验再提示节点名称必填', () => {
    f.setTitle('web-list', '')
    expect(f.configs['web-list'].title).toBe('')
    expect(f.validateFlow()).toContain('节点名称不能为空')
  })

  it('setDedupMode 切换去重方式（源内去重 vs 表内去重）', () => {
    f.setDedupMode('web-list', 'table')
    expect(f.configs['web-list'].collectCfg?.dedupMode).toBe('table')
    f.setDedupMode('web-list', 'source')
    expect(f.configs['web-list'].collectCfg?.dedupMode).toBe('source')
  })

  it('setOutFields 设置输出表勾选字段（与 taskCfg.outColumns 保持同步）', () => {
    f.setOutFields('web-detail', ['title', 'content'])
    expect(f.configs['web-detail'].collectCfg?.outFields).toEqual(['title', 'content'])
    expect(f.configs['web-detail'].taskCfg?.outColumns).toEqual(['title', 'content'])
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

describe('配置名 = 节点名（0828 D08/P4）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('新拉的节点自带配置名 = 节点名，且不继承模板上的 configId', () => {
    const before = f.main.length
    f.insertAfter('web-list', 'web')
    expect(f.main.length).toBe(before + 1)
    const newId = f.main[f.main.indexOf('web-list') + 1]
    expect(f.configs[newId].configName).toBe(f.configs[newId].title)
    expect(f.configs[newId].configId).toBeUndefined()
  })

  it('改节点名时配置名跟着走', () => {
    f.insertAfter('web-list', 'web')
    const newId = f.main[f.main.indexOf('web-list') + 1]
    f.setTitle(newId, '港股公司报道')
    expect(f.configs[newId].configName).toBe('港股公司报道')
  })

  it('用户单独改过配置名之后自动脱钩，再改节点名不覆盖他填的名字', () => {
    f.insertAfter('web-list', 'web')
    const newId = f.main[f.main.indexOf('web-list') + 1]
    f.setConfigName(newId, '我自己起的配置名')
    f.setTitle(newId, '港股公司报道')
    expect(f.configs[newId].title).toBe('港股公司报道')
    expect(f.configs[newId].configName).toBe('我自己起的配置名')
  })

  it('配置名为空时也跟随（迁移进来的节点没有配置名）', () => {
    f.setConfigName('web-list', '')
    f.setTitle('web-list', '列表抓取')
    expect(f.configs['web-list'].configName).toBe('列表抓取')
  })
})

describe('复制节点 = 新增一套配置（0828 D02）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('副本不继承原节点的 configId，配置名改成新节点名', () => {
    f.bindCopiedConfig('web-list', '1400774', '证券之星列表配置')
    expect(f.configs['web-list'].configId).toBe('1400774')

    const newId = f.duplicate('web-list')
    expect(newId).toBeTruthy()
    expect(f.configs[newId!].configId).toBeUndefined()
    expect(f.configs[newId!].title).toContain('（复制）')
    expect(f.configs[newId!].configName).toBe(f.configs[newId!].title)
    // 原节点不受影响
    expect(f.configs['web-list'].configId).toBe('1400774')
    expect(f.configs['web-list'].configName).toBe('证券之星列表配置')
  })

  it('duplicate 返回新节点 id，供调用方接着复制配置', () => {
    const newId = f.duplicate('web-list')
    expect(newId).toBeTruthy()
    expect(f.main).toContain(newId!)
    expect(f.duplicate('不存在的节点')).toBeUndefined()
  })

  it('副本内容与原节点一致，只是不共用配置身份', () => {
    f.patchCollect('web-list', { outputTable: '2103330' })
    const newId = f.duplicate('web-list')!
    expect(f.configs[newId].collectCfg?.outputTable).toBe('2103330')
    expect(f.configs[newId].title).toContain('（复制）')
  })

  it('bindCopiedConfig 绑上新配置后该节点无配置脏标（copyAll 是整条复制，内容本就一致）', () => {
    const newId = f.duplicate('web-list')!
    f.bindCopiedConfig(newId, '1400981', '证券之星列表配置_copy')
    expect(f.configs[newId].configId).toBe('1400981')
    expect(f.dirtyConfigNodes).not.toContain(newId)
  })

  it('分支内复制 duplicateNode 同样不继承 configId（两条复制路径都要断干净）', () => {
    f.bindCopiedConfig('web-list', '1400774', '证券之星列表配置')
    f.duplicateNode('web-list')
    const copies = f.main.filter((id: string) => id !== 'web-list' && f.configs[id]?.title === f.configs['web-list'].title)
    expect(copies.length).toBeGreaterThan(0)
    copies.forEach((id: string) => {
      expect(f.configs[id].configId).toBeUndefined()
      expect(f.configs[id].configName).toBe(f.configs[id].title)
    })
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

  it('S4-1：节点库存在网页登录，能插入主链，输出表可选（非固定）且自己不需要「登录」开关', () => {
    const flat = LIB_GROUPS.flatMap((g) => g.items)
    expect(flat.some((i) => i.template === 'login')).toBe(true)
    expect(TEMPLATE_TO_NODE.login).toBe('login-collect')

    const loginId = f.insertAfter('web-list', 'login')
    expect(f.configs[loginId].collectCfg?.collectorKind).toBe('login')

    const cap = collectorCapabilityOf(f.configs[loginId])!
    expect(cap.outputMode).toBe('selectable')
    expect(cap.supportsLogin).toBe(false)

    // 输出表可选（非固定防线），跟普通网页抓取节点一样能自由编辑
    f.patchCollect(loginId, { outputTable: 'login_session_table' })
    expect(f.configs[loginId].collectCfg?.outputTable).toBe('login_session_table')
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

  it('validateFlow：登录节点必须有旧平台登录字段、启用配置和默认配置', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'login')
    f.patchCollect(id, {
      url: 'https://example.com/login',
      loginConfigs: [
        { id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'main-user', loginPwd: 'pwd-1', newLoginConfig: '1', authConfig: '', enabled: true },
        { id: 'login-2', loginUrl: 'https://example.com/login', loginName: 'backup-user', loginPwd: 'pwd-2', newLoginConfig: '1', authConfig: '', enabled: true },
      ],
    })
    f.configs[id].collectCfg!.defaultLoginConfigId = 'missing'
    let errs = f.validateFlow()
    expect(errs).toContain('「网页登录」请选择一个启用的默认登录配置')

    f.patchCollect(id, { loginConfigs: [{ id: 'login-1', loginUrl: '', loginName: '', loginPwd: '', newLoginConfig: '1', authConfig: '', enabled: false }] })
    errs = f.validateFlow()
    expect(errs).toContain('「网页登录」至少需要一个启用的登录配置')
    expect(errs).toContain('「网页登录」登录配置的登录 URL、用户名、密码或已有登录模板不能为空')
  })

  it('流程保存快照不落盘登录密码，运行态快照可临时带出，重新加载不回填', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'login')
    f.patchCollect(id, {
      url: 'https://example.com/login',
      loginConfigs: [{ id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'alice', loginPwd: 'secret', newLoginConfig: '1', authConfig: '', enabled: true }],
      defaultLoginConfigId: 'login-1',
    })

    const saved = f.serialize()
    expect(saved.configs[id].collectCfg?.loginConfigs?.[0]).not.toHaveProperty('loginPwd')
    expect(JSON.stringify(saved)).not.toContain('secret')

    const runtime = f.serialize({ includeLoginPasswords: true })
    expect(runtime.configs[id].collectCfg?.loginConfigs?.[0].loginPwd).toBe('secret')

    f.load(runtime)
    expect(f.configs[id].collectCfg?.loginConfigs?.[0].loginPwd).toBe('')
  })

  it('serialize → load 往返一致', () => {
    f.newFlow('standard')
    const snap = f.serialize()
    f.newFlow('blank')
    f.load(snap)
    expect(f.main).toEqual(snap.main)
    expect(Object.keys(f.configs).sort()).toEqual(Object.keys(snap.configs).sort())
  })

  it('加载历史源定时策略时迁到首节点运行配置', () => {
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
    expect(f.configs['web-list'].schedule).toEqual({
      scheduleType: '每周', scheduleTime: '09:30', weekdays: [1, 3, 5], cron: '0 30 9 * * 1,3,5',
    })
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

  it('validateFlow：数据类节点缺输出表报错，通知类不报', () => {
    f.newFlow('blank')
    f.insertAfter('start', 'clean') // 无上游可继承 → 缺输出表
    const cleanId = f.selectedId
    f.insertAfter(cleanId, 'mail') // 通知类不要求输出表
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

  it('无有效输入表的首节点也保留任务参数、上下文来源和出参列', () => {
    f.patchCollect('web-list', { urlParamRefs: ['p-page'] })
    f.patchTaskConfig('web-list', {
      paramValues: [{ paramId: 'p-page', fieldId: 'page', valueExpr: '' }],
      contextMap: ['title'],
      outColumns: ['detail_url'],
    })
    expect(f.configs['web-list'].taskCfg).toMatchObject({
      paramValues: [{ paramId: 'p-page', fieldId: 'page', valueExpr: '' }],
      contextMap: ['title'],
      outColumns: ['detail_url'],
    })
    f.patchCollect('web-list', { inputTable: 'INPUT_T' })
    f.patchTaskConfig('web-list', {
      paramValues: [{ paramId: 'p-page', fieldId: 'page', valueExpr: '' }],
      contextMap: ['title'],
      outColumns: ['detail_url'],
    })
    expect(f.configs['web-list'].taskCfg).toMatchObject({
      paramValues: [{ paramId: 'p-page', fieldId: 'page', valueExpr: '' }],
      contextMap: ['title'],
      outColumns: ['detail_url'],
    })
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

  it('流程视图节点保留真实步骤元数据，并按依赖稳定排序', () => {
    const source = { sourceId: 's-step', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st2', sourceId: 's-step', name: '详情解析', inputTable: 'T1', outputTable: 'T2', dependsOn: ['st1'], condition: 'status=C', failAction: '跳过', enabled: false },
      { stepId: 'st1', sourceId: 's-step', name: '列表抓取', inputTable: '-', outputTable: 'T1', outColumns: ['detail_url'], enabled: true },
    ] as never)

    expect(seed.main).toEqual(['start', 'st1', 'st2', 'end'])
    expect(seed.configs.st1.collectCfg?.inputTable).toBe('')
    expect(seed.configs.st1.taskCfg?.outColumns).toEqual(['detail_url'])
    expect(seed.configs.st2.collectCfg?.entryCondition?.expr).toBe('status=C')
    expect(seed.configs.st2.outputAdvanced?.failPolicy).toBe('跳过')
    expect(seed.configs.st2.disabled).toBe(true)
  })

  it('配置绑定的参数回填到节点参数配置；节点已有绑定时不覆盖（2026-08-26 拍板：新平台优先）', () => {
    const source = { sourceId: 's-param', name: '测试源', url: 'http://x', mainTable: 'T1' } as never

    // 迁移值补空位：节点原本没有绑定，用配置上的 baidu-密码=aaaa 填上
    const seed = buildSourceSeed(source, [
      {
        stepId: 'st1', sourceId: 's-param', name: '列表抓取', inputTable: '-', outputTable: 'T1', enabled: true,
        paramBindings: [{ paramId: '730008', value: 'aaaa' }],
      },
    ] as never)
    expect(seed.configs.st1.collectCfg?.urlParamRefs).toEqual(['730008'])
    expect(seed.configs.st1.collectCfg?.urlParamValues).toEqual({ '730008': 'aaaa' })

    // 没有绑定的配置不产生任何参数字段
    const bare = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-param', name: '列表抓取', inputTable: '-', outputTable: 'T1', enabled: true },
    ] as never)
    expect(bare.configs.st1.collectCfg?.urlParamRefs ?? []).toEqual([])
  })

  it('步骤带真实 topic（configDetail 回填）时覆盖节点模板默认队列；没有 topic 时保留模板默认值', () => {
    const source = { sourceId: 's-topic', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-topic', name: '列表抓取', inputTable: '-', outputTable: 'T1', topic: 'news_snt', enabled: true },
      { stepId: 'st2', sourceId: 's-topic', name: '详情解析', inputTable: 'T1', outputTable: 'T2', dependsOn: ['st1'], enabled: true },
    ] as never)

    expect(seed.configs.st1.taskCfg?.queue).toBe('news_snt')
    // st2 没有 configDetail 回填的 topic：保留节点模板默认队列（web-detail 模板默认就是空），
    // 不能被 attachStepConfigDetails 查不到时的 undefined 静默覆盖成别的值。
    expect(seed.configs.st2.taskCfg?.queue).toBe('')
  })

  it('isLoginConfig 为真时路由到登录节点模板，即使步骤名不含"登录"二字（取自 2026-08-26 生产实测配置 1400968「baidu-登陆」）', () => {
    const source = { sourceId: 's-login', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-login', name: 'baidu-登陆', isLoginConfig: true, enabled: true },
    ] as never)

    expect(seed.configs.st1.collectCfg?.collectorKind).toBe('login')
  })

  it('已保存源没有 item/next 步骤时，流程视图显示源根列表节点', () => {
    const seed = buildSourceSeed({ sourceId: '391000001', name: '真实源', url: 'http://x', configId: 'c1', mainTable: 'T1', owner: 'a', state: 'C' }, [])
    expect(seed.main).toEqual(['start', 'source:391000001', 'end'])
    expect(seed.configs['source:391000001'].collectCfg?.webKind).toBe('list')
    expect(seed.configs['source:391000001'].collectCfg?.url).toBe('http://x')
    expect(seed.configs['source:391000001'].collectCfg?.outputTable).toBe('T1')
  })

  it('规则处理步骤按旧 SourceStep 回填：适用源、规则ID、入参来源、输入/输出表（2026-08-31 源 430022404 / 40604）', () => {
    const source = { sourceId: '430022404', name: '纽约市政府市长办公室新闻处_copy(0)', url: 'http://x', mainTable: '900' } as never
    const seed = buildSourceSeed(source, [
      { stepId: '0', sourceId: '430022404', name: '列表', inputTable: '-', outputTable: '900', configId: '1400979', enabled: true },
      {
        stepId: '40604', sourceId: '430022404', name: '1400979-规则处理',
        inputTable: '900', outputTable: '2100249', configId: '1400586', configName: 'NYC HPD-住房发展新闻',
        itemId: '-1', contextMap: ['K1', 'K2', 'K3', 'K4', 'K5'], enabled: false, dependsOn: ['0'],
      },
    ] as never)

    const rule = seed.configs['40604']
    expect(rule.ruleCfg).toBeTruthy()
    expect(rule.collectCfg).toBeUndefined()
    expect(rule.configId).toBe('1400586')
    expect(rule.configName).toBe('NYC HPD-住房发展新闻')
    expect(rule.itemId).toBe('-1')
    expect(rule.stepSourceId).toBe('430022404')
    expect(rule.inputTable).toBe('900')
    expect(rule.outputTable).toBe('2100249')
    expect(rule.ruleCfg?.inputTableId).toBe('900')
    expect(rule.ruleCfg?.outputTableId).toBe('2100249')
    expect(rule.taskCfg?.contextMap).toEqual(['K1', 'K2', 'K3', 'K4', 'K5'])
    expect(rule.disabled).toBe(true)
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

  it('未保存表配置（无 configId）：报「请先保存表配置」，不报「缺少输出表」', () => {
    const errs = f.validateFlow()
    expect(errs).toContain('「规则引擎处理」请先保存表配置')
    expect(errs.some((e) => e.includes('规则引擎处理') && e.includes('缺少输出表'))).toBe(false)
  })

  it('有 configId 但字段/脚本不全：分别报缺入参、缺出参、未生成脚本', () => {
    f.configs.rule.configId = '1400998'
    f.patchRuleConfig('rule', { mode: 'ref', inputFields: [], outputFields: [], script: '' })
    const errs = f.validateFlow()
    expect(errs).toContain('「规则引擎处理」缺少入参字段')
    expect(errs).toContain('「规则引擎处理」缺少出参字段')
    expect(errs).toContain('「规则引擎处理」尚未生成规则脚本')
    expect(errs).not.toContain('「规则引擎处理」请先保存表配置')
  })

  it('configId + 入参 + 出参 + 脚本齐全：不报任何规则相关错误', () => {
    f.configs.rule.configId = '1400998'
    f.patchRuleConfig('rule', {
      mode: 'ref', inputFields: ['sku_id'], outputFields: ['sku_name'],
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

  it('branchGroups 非空时序列化往返：每个分支的 label/chain 全部保留', () => {
    f.branchGroups.push({
      ownerId: 'web-list',
      branches: [
        { id: 'b-1', label: '正文', chain: ['ai-extract'] },
        { id: 'b-2', label: '详情', chain: ['clean'] },
      ],
    })
    const def = f.serialize()
    f.newFlow('blank')
    f.load(JSON.parse(JSON.stringify(def)))
    expect(f.branchGroups).toHaveLength(1)
    expect(f.branchGroups[0].ownerId).toBe('web-list')
    expect(f.branchGroups[0].branches).toHaveLength(2)
    expect(f.branchGroups[0].branches[0].label).toBe('正文')
    expect(f.branchGroups[0].branches[0].chain).toEqual(['ai-extract'])
  })

  it('conditionGroupLabel 多字段 AND/OR 展示', () => {
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

describe('分支段 store 操作（旧平台语义，1008-BR-06 重写）', () => {
  const mk = (stepId: string, dependsOn: string[], outputTable = '900'): Step => ({
    stepId, sourceId: '430016824', name: `n${stepId}`, dependsOn, inputTable: '900', outputTable, enabled: true,
  } as Step)
  let f: ReturnType<typeof useFlowStore>
  // 1 → {2, 3}：还原出来的真实分叉，分叉点 1 是普通节点
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.loadFromSource(
      { sourceId: '430016824', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C' } as never,
      [mk('1', ['0']), mk('2', ['1']), mk('3', ['1'])],
    )
  })

  it('节点库没有「逻辑」分组（决策 / 分头已去掉）', () => {
    expect(LIB_GROUPS.some((g) => g.title === '逻辑')).toBe(false)
    expect(TEMPLATE_TO_NODE.decision).toBeUndefined()
    expect(TEMPLATE_TO_NODE.parallel).toBeUndefined()
  })

  it('remove(分叉点)：级联删除整组 FlowBranchGroup + chain 内节点（BR-07 前的现状）', () => {
    f.remove('1')
    expect(f.branchGroups).toHaveLength(0)
    expect(f.configs['2']).toBeUndefined()
    expect(f.configs['3']).toBeUndefined()
  })

  it('remove(branch chain 内节点)：从 chain 摘除 + delete configs', () => {
    f.remove('3')
    expect(f.configs['3']).toBeUndefined()
    expect(f.branchGroups[0].branches.flatMap((b) => b.chain)).not.toContain('3')
  })

  // S6-3（方案 §4.4）：技术指导明确"暂时别删"——本期删节点只收集待清理资源清单，不真的调删除接口。
  it('remove(带 scriptPath/configId 的规则节点)：待清理清单记下 scriptPath + configId，节点仍正常删除', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'rule')
    f.configs[id].configId = '1400998'
    f.patchRuleConfig(id, { mode: 'ref', scriptPath: '/rules/orch-173.py' })
    expect(f.pendingCleanup).toHaveLength(0)

    f.remove(id)

    expect(f.configs[id]).toBeUndefined() // 节点本身照常删除，S6-3 不影响这条
    expect(f.pendingCleanup).toHaveLength(1)
    expect(f.pendingCleanup[0]).toMatchObject({ nodeId: id, scriptPath: '/rules/orch-173.py', configId: '1400998' })
  })

  it('remove(非规则节点，execCfg 带 scriptPath 且节点有 configId)：同样记待清理清单', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'web')
    f.configs[id].configId = '184'
    f.patchExecConfig(id, { mode: 'ref', scriptPath: '/x/184.xml' })

    f.remove(id)

    expect(f.pendingCleanup).toHaveLength(1)
    expect(f.pendingCleanup[0]).toMatchObject({ nodeId: id, scriptPath: '/x/184.xml', configId: '184' })
  })

  it('remove(从没保存过配置的节点)：没有 scriptPath/configId 就不记入清单', () => {
    f.newFlow('blank')
    const id = f.insertAfter('start', 'web')
    f.remove(id)
    expect(f.pendingCleanup).toHaveLength(0)
  })

  it('validateFlow：chain 节点也走主链节点同套校验（新建分支的采集节点缺源 URL 则拦截）', () => {
    f.addSibling('3', 'web')
    expect(f.validateFlow().some((e) => e.includes('缺少源 URL'))).toBe(true)
  })

  // 还原出来的都是采集节点，表在 collectCfg 上（nodeOutputTable / nodeInputTable 先读它）
  const setTable = (id: string, key: 'inputTable' | 'outputTable', table: string) => {
    const c = f.configs[id]
    if (c.collectCfg) c.collectCfg[key] = table
    else c[key] = table
  }

  it('addNodeToBranch：挂进 chain 末尾；输出表继承链内前一个节点', () => {
    setTable('2', 'outputTable', 'T2')
    const branchId = f.branchGroups[0].branches[0].id
    const n = f.addNodeToBranch('1', branchId, 'parse')!
    expect(f.branchGroups[0].branches[0].chain).toEqual(['2', n])
    expect(f.configs[n].outputTable).toBe('T2')
  })

  it('分支链头没设输入表时，有效输入表 = 分叉点的输出表（旧平台：新步骤输入表 = 上级输出表）', () => {
    setTable('1', 'outputTable', 'OWNER_OUT')
    setTable('2', 'inputTable', '')
    expect(f.effectiveInputTableFor('2')).toBe('OWNER_OUT')
  })

  it('addNodeToBranch：ownerId/branchId 不存在时拒绝', () => {
    expect(f.addNodeToBranch('ghost-owner', 'ghost-branch', 'web')).toBeNull()
  })

  it('复制分叉点：副本插在原节点下方并接管它的子节点，不再复制出共用链节点的第二组分支', () => {
    const copy = f.duplicate('1')!
    expect(f.main).toEqual(['start', '1', copy, 'end'])
    expect(f.branchGroups).toHaveLength(1)
    expect(f.branchGroups[0].ownerId).toBe(copy)
    expect(f.branchGroups[0].branches.map((b) => b.chain)).toEqual([['2'], ['3']])
  })

  it('复制分支里的节点：副本出现在画布上（原来只往主链里插，分支节点的副本看不到）', () => {
    const copy = f.duplicate('3')!
    expect(f.branchGroups[0].branches.map((b) => b.chain)).toEqual([['2'], ['3', copy]])
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

  it('rebindNodeId 把本地草稿 id 换成后端 itemConfig，并改选中态', () => {
    f.newFlow('blank')
    f.insertAfter('start', 'web')
    const localId = f.selectedId
    expect(localId).toMatch(/^web-/)
    expect(f.rebindNodeId(localId, '40600')).toBe(true)
    expect(f.configs['40600']?.title).toBeTruthy()
    expect(f.configs[localId]).toBeUndefined()
    expect(f.main).toContain('40600')
    expect(f.main).not.toContain(localId)
    expect(f.selectedId).toBe('40600')
  })

  it('rebindNodeId 递归换绑嵌套 subGroups 的 owner 与 chain（0926 REVIEW F-R1）', () => {
    // 还原拓扑：a → {b, c}，b → {d, e}——b 是链内再分叉的 owner，它的组嵌在 a 组分支 1 的 subGroups 里
    const mk = (stepId: string, dependsOn: string[]) =>
      ({ stepId, sourceId: 's1', name: `n${stepId}`, dependsOn, inputTable: '900', outputTable: '900', enabled: true }) as never
    f.loadFromSource(
      { sourceId: 's1', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C' } as never,
      [mk('a', ['0']), mk('b', ['a']), mk('c', ['a']), mk('d', ['b']), mk('e', ['b'])],
    )
    const b = 'b'
    const topGroup = f.branchGroups.find((g) => g.ownerId === 'a')!
    const nestedGroup = topGroup.branches[0].subGroups![0]
    expect(nestedGroup.ownerId).toBe(b)
    // 嵌套分支列内「＋」新增节点：addNodeToBranch 按 ownerId 递归定位嵌套组
    const childId = f.addNodeToBranch(b, nestedGroup.branches[0].id, 'parse')!
    expect(nestedGroup.branches[0].chain).toContain(childId)
    // 换绑草稿 id：嵌套 subGroups 的 chain 必须跟着换成后端 id（旧实现只改顶层，这里会挂）
    expect(f.rebindNodeId(childId, '40601')).toBe(true)
    expect(nestedGroup.branches[0].chain).toContain('40601')
    expect(nestedGroup.branches[0].chain).not.toContain(childId)
    expect(f.configs['40601']?.title).toBeTruthy()
    // 换绑链上节点 b：它同时是嵌套组 owner + 顶层分支链成员，两处都要换成新 id
    expect(f.rebindNodeId(b, '40602')).toBe(true)
    expect(nestedGroup.ownerId).toBe('40602')
    expect(topGroup.branches[0].chain).toContain('40602')
    expect(topGroup.branches[0].chain).not.toContain(b)
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

  it('数据处理组只保留字典里独立编号的类型，通用数据处理节点已去除', () => {
    expect(LIB_GROUPS.map((group) => group.title)).toEqual(expect.not.arrayContaining(['解析结构化', '数据清洗', '数据校验']))
    // 2026-09-23 用户明确要求：节点类型「数据处理」去除（纯前端移除 PROC 通用入口），
    // 组内只保留后端字典里 300/700/710/720/730/800 独立编号的类型。
    expect(LIB_GROUPS.find((group) => group.title === '数据处理')?.items.map((it) => it.name)).toEqual([
      '校验类', '视频提取音频', '音频提取文字', '文章生成摘要', '文章打标签', '翻译助手',
    ])
    expect(LIB_GROUPS.flatMap((g) => g.items).some((it) => it.name === '数据处理' || it.code === 'PROC')).toBe(false)

    const flow = mockFlowRecommend({ intent: 'file-parse' }).flow
    const titles = nodeIds(flow.main).map((id) => flow.configs[id].title)
    expect(titles).not.toEqual(expect.arrayContaining(['文件解析', '字段抽取']))
  })

  // 2026-09-17：节点库必须与后端字典逐条对齐（用户口径：17 条类型都能看见、都能选）
  it('节点库覆盖后端字典全部 19 条抓取类型', () => {
    const items = LIB_GROUPS.flatMap((g) => g.items)
    const numeric = new Set(items.map((it) => Number(it.badge ?? it.code)).filter((n) => Number.isInteger(n)))
    for (const code of [90, 110, 120, 130, 140, 150, 160, 170, 300, 400, 500, 600, 610, 620, 700, 710, 720, 730, 800]) {
      expect(numeric.has(code), `节点库缺少类型 ${code}`).toBe(true)
    }
    // 每个条目都得能落到一个存在的节点种子上，否则点了没反应
    items.forEach((it) => {
      const seedKey = TEMPLATE_TO_NODE[it.template]
      expect(seedKey, `模板 ${it.template} 没有种子映射`).toBeTruthy()
      expect(NODE_CONFIGS[seedKey], `模板 ${it.template} 映射到了不存在的种子 ${seedKey}`).toBeTruthy()
    })
  })
})

describe('APP 抓取节点（0707 Phase 8）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('blank')
  })

  // 2026-08-28 订正：原来断言的 `[95] - APP 抓取` 是臆造值——后端字典 config/sourceTypes
  // 里根本没有 95，真实 App 抓取是 140。95 不是无害的显示问题：sourceTypeFromSnatchType
  // 会把它解析成 sourceType=95 写进新建源请求体。字典逐条锁定见 canvas/legacyEnums.test.ts。
  it('添加浮层提供 APP 抓取模板，插入后使用 [140] App抓取配置', () => {
    const collectGroup = LIB_GROUPS.find((g) => g.title === '采集类')
    expect(collectGroup?.items.some((it) => it.template === 'app' && it.name === 'APP 抓取')).toBe(true)
    expect(TEMPLATE_TO_NODE.app).toBe('app-collect')
    expect(TEMPLATE_TO_SNATCH.app).toBe('[140] - App抓取')

    const id = f.insertAfter('start', 'app')
    expect(f.configs[id].title).toBe('APP 抓取')
    expect(f.configs[id].collectCfg?.snatchType).toBe('[140] - App抓取')
    expect(f.configs[id].base.some(([label]) => label === '包名')).toBe(true)
  })
})

// 2026-09-17：与后端 source_type 字典对齐后新增的类型，插入后必须带上正确的节点类型
// （采集类看 collectCfg.snatchType，其它看 template → configType 映射）。
describe('节点类型补齐（2026-09-17，与后端 source_type 对齐）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('blank')
  })

  it.each([
    ['excel', 'EXCEL抓取', '[110] - EXCEL抓取'],
    ['doc', 'DOC抓取', '[120] - DOC抓取'],
    ['pdf', 'PDF抓取', '[130] - PDF抓取'],
    ['mail-collect', 'Mail抓取', '[160] - Mail抓取'],
    ['news', '资讯抓取', '[500] - 资讯抓取'],
  ])('插入 %s：节点名与抓取类型都对上', (template, title, snatchType) => {
    expect(TEMPLATE_TO_SNATCH[template]).toBe(snatchType)
    const id = f.insertAfter('start', template)
    expect(f.configs[id].template).toBe(template)
    expect(f.configs[id].title).toBe(title)
    expect(f.configs[id].collectCfg?.snatchType).toBe(snatchType)
  })

  // OCR 沿用历史上的处理型种子（有 OCR 引擎/文件来源那套字段，没有源 URL），
  // 所以它跟 700/710/720 一样靠 template → configType 落 150（见 nodeConfigPayload.test.ts）。
  it.each([
    ['ocr', 'OCR抓取'],
    ['video-audio', '视频提取音频'],
    ['audio-text', '音频提取文字'],
    ['article-summary', '文章生成摘要'],
    ['check', '校验类'],
  ])('插入 %s：名字取节点库条目，节点上没有采集配置', (template, title) => {
    const id = f.insertAfter('start', template)
    expect(f.configs[id].template).toBe(template)
    expect(f.configs[id].title).toBe(title)
    expect(f.configs[id].collectCfg).toBeUndefined()
  })

  it('徽标取节点自己的类型编号（新类型不再退化成 NODE）', () => {
    const videoId = f.insertAfter('start', 'video-audio')
    expect(iconFor(f.configs[videoId])).toBe('700')
    const excelId = f.insertAfter('start', 'excel')
    expect(iconFor(f.configs[excelId])).toBe('110')
    // 用户改过抓取类型的节点按改后的算（snatchType 优先于种子里的 sub）
    f.configs[excelId].collectCfg!.snatchType = '[130] - PDF抓取'
    expect(iconFor(f.configs[excelId])).toBe('130')
  })

  // 2026-09-23 用户明确要求：OCR / 翻译 / 摘要 / 标签 / 语音 / 视频 新增时任务配置默认给队列名
  // 2026-10-08 用户明确要求：PDF 抓取默认 dev_web_snatch_pdf
  it.each([
    ['rule', 'dev_web_rulehandle'],
    ['ocr', 'dev_web_snatch_ocr'],
    ['pdf', 'dev_web_snatch_pdf'],
    ['translate', 'dev_web_translate'],
    ['article-summary', 'dev_web_llm_generate'],
    ['article-tag', 'dev_web_llm_generate'],
    ['audio-text', 'dev_web_audiototext'],
    ['video-audio', 'dev_web_videotoaudio'],
  ])('主链新增节点 %s：默认任务队列为 %s', (template, expectedQueue) => {
    const id = f.insertAfter('start', template)
    expect(f.configs[id].taskCfg?.queue).toBe(expectedQueue)
  })

  it.each([
    ['rule', 'dev_web_rulehandle'],
    ['ocr', 'dev_web_snatch_ocr'],
    ['pdf', 'dev_web_snatch_pdf'],
    ['translate', 'dev_web_translate'],
    ['article-summary', 'dev_web_llm_generate'],
    ['article-tag', 'dev_web_llm_generate'],
    ['audio-text', 'dev_web_audiototext'],
    ['video-audio', 'dev_web_videotoaudio'],
  ])('分支内新增节点 %s：默认任务队列为 %s', (template, expectedQueue) => {
    const ownerId = f.insertAfter('start', 'web')
    f.addSibling(f.insertAfter(ownerId, 'web'), 'web')
    const branchId = f.branchGroups[0].branches[0].id
    const id = f.addNodeToBranch(ownerId, branchId, template)!
    expect(f.configs[id].taskCfg?.queue).toBe(expectedQueue)
  })
})

// 2026-09-01 新增「数据监控」节点：用户明确要求配置先跟「规则处理」一样，
// 复用同一套 rule 种子（TEMPLATE_TO_NODE.monitor='rule'），不单独起一套 Tab/字段逻辑。
describe('数据监控节点（2026-09-01，配置同规则处理）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('节点库存在「数据监控」，映射到 rule 种子，插入后是结构意义上的规则节点', () => {
    const ruleGroup = LIB_GROUPS.find((g) => g.title === '规则类')
    expect(ruleGroup?.items.some((it) => it.template === 'monitor' && it.name === '数据监控')).toBe(true)
    expect(TEMPLATE_TO_NODE.monitor).toBe('rule')

    const upstreamId = f.main.find((id) => id !== 'start' && id !== 'end')!
    const id = f.insertAfter(upstreamId, 'monitor')

    expect(f.configs[id].title).toBe('数据监控')
    // 结构信号而不是标题正则：改名不含"规则"二字也不会被误判成非规则节点
    expect(isRuleNode(f.configs[id])).toBe(true)
    // template 结构信号区分「数据监控」与「规则处理」（monitor 复用 rule 种子）
    expect(f.configs[id].template).toBe('monitor')
    expect(isMonitorNode(f.configs[id])).toBe(true)
    // 跟「规则处理」共用 applyRuleStepDefaults：自动继承上游输出表作为本节点输入表
    const upstreamTable = f.configs[upstreamId].collectCfg?.outputTable || f.configs[upstreamId].outputTable
    expect(f.configs[id].ruleCfg?.inputTableId).toBe(upstreamTable)
  })

  it('画布图标/样式按结构信号识别为规则节点（不依赖标题含"规则"二字）', () => {
    const id = f.insertAfter('start', 'monitor')
    expect(iconFor(f.configs[id])).toBe('R')
    expect(nodeClassFor(f.configs[id])).toBe('rule-node')
  })

  it('上游有 configId 时，数据监控节点名保留「数据监控」而非被顶成「规则处理」（2026-09-01 修复）', () => {
    const upstreamId = f.main.find((id) => id !== 'start' && id !== 'end')!
    f.configs[upstreamId].configId = '1400979'
    const id = f.insertAfter(upstreamId, 'monitor')!
    expect(f.configs[id].title).toBe('1400979-数据监控')
    expect(f.configs[id].configName).toBe('1400979-数据监控')
    // 结构信号仍按规则节点识别（配置复用 rule 种子），仅命名不再顶成「规则处理」
    expect(isRuleNode(f.configs[id])).toBe(true)
  })

  it('从后端步骤回读时，节点名「数据监控」补回 template=monitor，仍识别为监控节点（2026-09-01 修复）', () => {
    // 新建 monitor 保存时 nodeType 继承前置步骤（这里是 list），后端 Step 无 template 字段；
    // 回读靠 buildNodeForStep 的节点名识别补回结构信号，否则 isMonitorNode 恒 false。
    const source = { sourceId: 's-mon', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-mon', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-mon', name: '数据监控', inputTable: 'T1', outputTable: 'T1', nodeType: 'entry', dependsOn: ['st1'], enabled: true },
    ] as never)

    const mon = seed.configs.st2
    expect(isRuleNode(mon)).toBe(true)
    expect(isMonitorNode(mon)).toBe(true)
    expect(mon.template).toBe('monitor')
  })

  // Z6-2（2026-09-07）：nodeType='monitor' 现在也是可信信号，跟标题正则谁先谁后要钉死。
  it('nodeType 显式为 monitor 时权威：用户改了名字，不含"数据监控"也仍识别为监控节点', () => {
    const source = { sourceId: 's-mon2', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-mon2', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      // 名字改成了"异常预警"，不含"数据监控"——只有 nodeType 还说得清它的真实类型
      { stepId: 'st2', sourceId: 's-mon2', name: '异常预警', inputTable: 'T1', outputTable: 'T1', nodeType: 'monitor', dependsOn: ['st1'], enabled: true },
    ] as never)

    const mon = seed.configs.st2
    expect(isRuleNode(mon)).toBe(true)
    expect(isMonitorNode(mon)).toBe(true)
    expect(mon.template).toBe('monitor')
  })

  // 存量步骤的 nodeType 继承自前置步骤（entry/list/detail 之类），不是可信信号——
  // 这类值不该越过标题正则反而把普通采集节点错判成监控节点。
  it('nodeType 是继承来的默认值（非 monitor）时不影响判定，标题正则仍生效', () => {
    const source = { sourceId: 's-mon3', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-mon3', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-mon3', name: '数据监控', inputTable: 'T1', outputTable: 'T1', nodeType: 'list', dependsOn: ['st1'], enabled: true },
    ] as never)

    expect(seed.configs.st2.template).toBe('monitor')
  })
})

describe('数据校验节点（sourceType=800，配置参考数据监控）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('节点库存在数据校验，复用 rule 种子但使用独立 template', () => {
    const ruleGroup = LIB_GROUPS.find((g) => g.title === '规则类')
    expect(ruleGroup?.items.some((it) => it.template === 'data-validation' && it.name === '数据校验')).toBe(true)
    expect(TEMPLATE_TO_NODE['data-validation']).toBe('rule')
    const upstreamId = f.main.find((id) => id !== 'start' && id !== 'end')!
    const id = f.insertAfter(upstreamId, 'data-validation')!
    expect(f.configs[id].title).toBe('数据校验')
    expect(f.configs[id].template).toBe('data-validation')
    expect(isRuleNode(f.configs[id])).toBe(true)
    expect(isDataValidationNode(f.configs[id])).toBe(true)
  })

  // 2026-09-17：800 现在是「翻译助手」，620 才是数据校验。800 只在名字指向校验时按校验认
  //（09-07～09-17 本前端把 800 当作数据校验写出去过）。
  it('按 sourceType=620 回读为数据校验节点；800 + 校验名回读仍是数据校验（存量）', () => {
    const source = { sourceId: 's-validation', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-validation', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-validation', name: '字段检查', inputTable: 'T1', outputTable: 'T1', configType: '620', nodeType: 'entry', dependsOn: ['st1'], enabled: true },
      { stepId: 'st3', sourceId: 's-validation', name: '数据校验', inputTable: 'T1', outputTable: 'T1', configType: '800', nodeType: 'entry', dependsOn: ['st2'], enabled: true },
    ] as never)
    expect(seed.configs.st2.template).toBe('data-validation')
    expect(isDataValidationNode(seed.configs.st2)).toBe(true)
    expect(seed.configs.st3.template).toBe('data-validation')
  })

  it('按 sourceType=730 回读为文章打标签节点', () => {
    const source = { sourceId: 's-tag', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-tag', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-tag', name: '文章打标签', inputTable: 'T1', outputTable: 'T1', configType: '730', nodeType: 'entry', dependsOn: ['st1'], enabled: true },
    ] as never)
    expect(seed.configs.st2.template).toBe('article-tag')
    expect(nodeTypeLabel(seed.configs.st2)).toBe('文章打标签')
  })

  // 2026-09-18：文章打标签与翻译助手同待遇——表绑定与规则处理同口径落步骤，
  // 回读时把步骤里的输入/输出表填回 execCfg，否则「表配置」刷新后就是空的。
  it('回读时把步骤的输入/输出表填回 execCfg（文章打标签与规则处理同口径）', () => {
    const source = { sourceId: 's-tag2', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-tag2', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-tag2', name: '文章打标签', inputTable: 'T1', outputTable: 'T1', configType: '730', nodeType: 'entry', dependsOn: ['st1'], enabled: true },
    ] as never)
    const cfg = seed.configs.st2
    expect(cfg.template).toBe('article-tag')
    // 不能误写成 ruleCfg——那会把文章打标签误判成规则节点
    expect(cfg.ruleCfg).toBeUndefined()
    expect(cfg.execCfg?.inputTableId).toBe('T1')
    expect(cfg.execCfg?.outputTableId).toBe('T1')
    expect(cfg.inputTable).toBe('T1')
    expect(cfg.outputTable).toBe('T1')
  })

  // 2026-09-18：翻译助手 / 文章打标签步骤的 type 与规则处理一样写 'rule'（发后续按 type
  // 派发执行器，写 entry 会 500）。回读时必须靠 configType（730/800）路由到各自的种子，
  // 不能被 nodeType='rule' 的别名映射抢先路由成带 ruleCfg 的规则节点。
  it('type=rule + configType=730 回读为文章打标签（不落 ruleCfg）', () => {
    const source = { sourceId: 's-tag3', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-tag3', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-tag3', name: '文章打标签', inputTable: 'T1', outputTable: 'T1', configType: '730', nodeType: 'rule', dependsOn: ['st1'], enabled: true },
    ] as never)
    const cfg = seed.configs.st2
    expect(cfg.template).toBe('article-tag')
    expect(cfg.ruleCfg).toBeUndefined()
  })

  it('type=rule + configType=800 回读为翻译助手（不落 ruleCfg）', () => {
    const source = { sourceId: 's-tr3', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-tr3', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-tr3', name: '翻译助手', inputTable: 'T1', outputTable: 'T1', configType: '800', nodeType: 'rule', dependsOn: ['st1'], enabled: true },
    ] as never)
    const cfg = seed.configs.st2
    expect(cfg.template).toBe('translate')
    expect(cfg.ruleCfg).toBeUndefined()
  })

  // 2026-09-18：摘要 / 音频转文字 / 视频转音频同样与规则处理一致写 type='rule'，
  // 回读按 configType 路由到各自的种子，不落 ruleCfg。
  // 2026-09-22：OCR 抓取并入同一套（isRuleLikeNode）。
  it.each([
    ['700', 'video-audio', '视频提取音频'],
    ['710', 'audio-text', '音频提取文字'],
    ['720', 'article-summary', '文章生成摘要'],
    ['150', 'ocr', 'OCR抓取'],
  ])('type=rule + configType=%s 回读为 %s（不落 ruleCfg）', (configType, template, name) => {
    const source = { sourceId: `s-${configType}`, name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: `s-${configType}`, name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: `s-${configType}`, name, inputTable: 'T1', outputTable: 'T1', configType, nodeType: 'rule', dependsOn: ['st1'], enabled: true },
    ] as never)
    const cfg = seed.configs.st2
    expect(cfg.template).toBe(template)
    expect(cfg.ruleCfg).toBeUndefined()
  })

  it('按 sourceType=800（名字不是校验）回读为翻译助手节点', () => {
    const source = { sourceId: 's-translate', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-translate', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-translate', name: '翻译助手', inputTable: 'T1', outputTable: 'T1', configType: '800', nodeType: 'entry', dependsOn: ['st1'], enabled: true },
    ] as never)
    expect(seed.configs.st2.template).toBe('translate')
    expect(nodeTypeLabel(seed.configs.st2)).toBe('翻译助手')
  })

  // 2026-09-18 修：翻译助手的表绑定与规则处理同口径落步骤，回读时必须把步骤里的
  // 输入/输出表填回 execCfg——只填 ruleCfg 的话翻译助手的「表配置」刷新后表就是空的
  //（入参/出参字段还原也依赖这个表 ID 去拉字段池）。
  it('回读时把步骤的输入/输出表填回 execCfg（翻译助手与规则处理同口径）', () => {
    const source = { sourceId: 's-translate2', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-translate2', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-translate2', name: '翻译助手', inputTable: 'T1', outputTable: 'T1', configType: '800', nodeType: 'entry', dependsOn: ['st1'], enabled: true },
    ] as never)
    const cfg = seed.configs.st2
    expect(cfg.template).toBe('translate')
    // 不能误写成 ruleCfg——那会把翻译助手误判成规则节点
    expect(cfg.ruleCfg).toBeUndefined()
    expect(cfg.execCfg?.inputTableId).toBe('T1')
    expect(cfg.execCfg?.outputTableId).toBe('T1')
    // 顶层输入/输出表同样回填（与其它非采集节点一致）
    expect(cfg.inputTable).toBe('T1')
    expect(cfg.outputTable).toBe('T1')
  })

  // 2026-09-22：OCR 抓取的表绑定跟翻译助手同一口径（表配置并入规则式绑定），
  // 回读时同样要把步骤里的输入/输出表填回 execCfg。
  it('回读时把步骤的输入/输出表填回 execCfg（OCR 抓取）', () => {
    const source = { sourceId: 's-ocr', name: '测试源', url: 'http://x', mainTable: 'T1' } as never
    const seed = buildSourceSeed(source, [
      { stepId: 'st1', sourceId: 's-ocr', name: '列表抓取', inputTable: '-', outputTable: 'T1', nodeType: 'list', enabled: true },
      { stepId: 'st2', sourceId: 's-ocr', name: 'OCR抓取', inputTable: 'T1', outputTable: 'T1', configType: '150', nodeType: 'rule', dependsOn: ['st1'], enabled: true },
    ] as never)
    const cfg = seed.configs.st2
    expect(cfg.template).toBe('ocr')
    expect(cfg.ruleCfg).toBeUndefined()
    expect(cfg.execCfg?.inputTableId).toBe('T1')
    expect(cfg.execCfg?.outputTableId).toBe('T1')
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
  it('源序列化时保存模板版本和当前节点动态绑定', () => {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const source: Source = {
      sourceId: 'source-template-binding', name: '模板源', url: 'https://source.example.com', configId: '', mainTable: '', owner: 'tester', state: 'C',
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
      sourceId: 'source-template-upgrade', name: '模板升级源', url: 'https://source.example.com', configId: '', mainTable: '', owner: 'tester', state: 'C',
    }
    flow.loadFromSource(source, [])
    const template = makePresetFlowTemplates().find((item) => item.id === 'preset-file-parse')!
    const fileId = template.definition.main.find((id) => id !== 'start' && id !== 'end')!
    flow.applyTemplate(template)
    flow.patchCollect(fileId, { url: 'https://source.example.com/report.pdf' })
    const upgraded = {
      ...template,
      version: (template.version ?? 0) + 1,
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

describe('双层脏状态（0824-00 §5.4）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
  })

  it('节点配置表单改动只置 configDirty，并按节点记账', () => {
    f.setDedupMode('web-list', 'table')
    expect(f.configDirty).toBe(true)
    expect(f.flowDirty).toBe(false)
    expect(f.dirtyConfigNodes).toEqual(['web-list'])
    expect(f.dirty).toBe(true)
  })

  it('拓扑动作只置 flowDirty', () => {
    f.insertAfter('web-list', 'web')
    expect(f.flowDirty).toBe(true)
    expect(f.configDirty).toBe(false)
  })

  it('保存配置：清本节点 config 脏标，并把流程置脏（§5.5 配置内容变了 → 流程待保存）', () => {
    f.setDedupMode('web-list', 'table')
    f.markNodeConfigSaved('web-list')
    expect(f.configDirty).toBe(false)
    expect(f.flowDirty).toBe(true)
  })
})

describe('configDetail 异步回填（applyStepDetails）', () => {
  let f: ReturnType<typeof useFlowStore>
  const source = { sourceId: 'S1', name: '测试源', url: 'https://example.com/list', mainTable: '900', configId: '1000', owner: '', state: 'C' } as Source
  const bareSteps = [
    { stepId: 'st-1', sourceId: 'S1', name: '列表抓取', configId: '1000', enabled: true },
    { stepId: 'st-2', sourceId: '-1', name: 'baidu-登陆', configId: '1001', enabled: true },
  ] as unknown as Parameters<typeof f.applyStepDetails>[0]

  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.loadFromSource(source, bareSteps as never, null)
  })

  it('裸步骤先画出来：没有 configDetail 时队列/配置名回落默认值', () => {
    expect(Object.keys(f.configs)).toEqual(expect.arrayContaining(['st-1', 'st-2']))
    expect(f.configs['st-1'].configName).toBeUndefined()
  })

  it('补充到达后回填配置名 / 队列 / 是否列表，且不置任何脏标', () => {
    const enriched = [
      { ...bareSteps[0], configName: '公告列表配置', configUrl: 'http://www.baidu.com', topic: 'q_list', multiMode: 1, runPolicy: '{"snatch":{"retryCnt":3}}' },
      { ...bareSteps[1], configName: 'baidu-登陆配置', topic: 'q_login' },
    ]
    f.applyStepDetails(enriched as never)

    expect(f.configs['st-1'].configName).toBe('公告列表配置')
    expect(f.configs['st-1'].configUrl).toBe('http://www.baidu.com')
    expect(f.configs['st-1'].taskCfg?.queue).toBe('q_list')
    expect(f.configs['st-1'].collectCfg?.multiMode).toBe(1)
    expect(f.configs['st-1'].runPolicy).toBe('{"snatch":{"retryCnt":3}}')
    // 回读不是用户改动
    expect(f.dirty).toBe(false)
    expect(f.configDirty).toBe(false)
    expect(f.flowDirty).toBe(false)
  })

  it('isLoginConfig 迟到时整节点重建成登录节点，并回报被重建的 nodeId', () => {
    // 步骤名是"登陆"不是"登录"，名字正则漏判，只能靠 isLoginConfig
    expect(collectorCapabilityOf(f.configs['st-2'])?.kind).not.toBe('login')

    const rebuilt = f.applyStepDetails([
      bareSteps[0],
      { ...bareSteps[1], isLoginConfig: true, configName: 'baidu-登陆配置' },
    ] as never)

    expect(rebuilt).toEqual(['st-2'])
    expect(collectorCapabilityOf(f.configs['st-2'])?.kind).toBe('login')
    expect(f.configs['st-2'].configName).toBe('baidu-登陆配置')
    expect(f.dirty).toBe(false)
  })

  // 2026-09-18：打标签步骤 type 与规则处理一样写 'rule'，首屏（configDetail 还没回填）
  // 会被 nodeType 别名路由先画成规则节点；configType=730 回填后必须整节点重建成
  // 文章打标签——光补字段会留下 ruleCfg，节点被永久误判成规则节点。
  it('type=rule 的打标签步骤在 configType=730 回填后整节点重建，ruleCfg 不残留', () => {
    const tagSource = { sourceId: 'S2', name: '测试源', url: 'https://example.com/list', mainTable: '900', configId: '1000', owner: '', state: 'C' } as Source
    const tagSteps = [
      { stepId: 'st-1', sourceId: 'S2', name: '列表抓取', configId: '1000', enabled: true, nodeType: 'list', inputTable: '-', outputTable: '900' },
      { stepId: 'st-2', sourceId: 'S2', name: '文章打标签', configId: '1002', enabled: true, nodeType: 'rule', inputTable: '900', outputTable: '900', dependsOn: ['st-1'] },
    ] as never
    const store = useFlowStore()
    store.loadFromSource(tagSource, tagSteps, null)
    // 首屏没有 configType：type=rule 被别名路由成规则节点（带 ruleCfg）
    expect(isRuleNode(store.configs['st-2'])).toBe(true)

    const rebuilt = store.applyStepDetails([
      { stepId: 'st-1', sourceId: 'S2', name: '列表抓取', configId: '1000', enabled: true, nodeType: 'list', inputTable: '-', outputTable: '900' },
      { stepId: 'st-2', sourceId: 'S2', name: '文章打标签', configId: '1002', enabled: true, nodeType: 'rule', inputTable: '900', outputTable: '900', configType: '730', dependsOn: ['st-1'] },
    ] as never)

    expect(rebuilt).toEqual(['st-2'])
    const cfg = store.configs['st-2']
    expect(cfg.template).toBe('article-tag')
    expect(isRuleNode(cfg)).toBe(false)
  })
})

describe('源 URL 归源（0824-11 §1.1b）', () => {
  let f: ReturnType<typeof useFlowStore>
  beforeEach(() => {
    setActivePinia(createPinia())
    f = useFlowStore()
    f.newFlow('standard')
    f.patchSource({ sourceId: 'S1', name: '测试源', url: 'https://old.example/list' } as Partial<Source>)
    f.markSaved()
  })

  it('改源 URL 写进源，并同步到各采集节点的显示副本', () => {
    f.patchSource({ url: 'https://new.example/list' })
    expect(f.sourceCfg?.url).toBe('https://new.example/list')
    const collectNodes = Object.values(f.configs).filter((c) => c.collectCfg)
    expect(collectNodes.length).toBeGreaterThan(0)
    collectNodes.forEach((c) => expect(c.collectCfg?.url).toBe('https://new.example/list'))
  })

  it('源 URL 归流程脏（步骤自动保存管），不是配置脏', () => {
    f.patchSource({ url: 'https://new.example/list' })
    expect(f.flowDirty).toBe(true)
    expect(f.configDirty).toBe(false)
  })
})

describe('垂直布局：还原拓扑的 fan-out 与嵌套分叉（0925 完整还原）', () => {
  const mk = (stepId: string, dependsOn: string[]): Step => ({
    stepId, sourceId: '430016824', name: `n${stepId}`, dependsOn, inputTable: '900', outputTable: '900', enabled: true,
  } as Step)

  it('普通采集节点分叉也 fan-out（不再只在 decision/parallel 下展开）', () => {
    setActivePinia(createPinia())
    const f = useFlowStore()
    f.loadFromSource(
      { sourceId: '430016824', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C' } as never,
      [mk('1', ['0']), mk('2', ['1']), mk('3', ['2']), mk('4', ['2'])],
    )
    const layout = f.layout
    expect(f.branchGroups[0].ownerId).toBe('2')
    expect(layout.fanOutColMeta['2']).toBeDefined()
    expect(layout.fanOutColMeta['2'].branches.map((b) => b.chain)).toEqual([['3'], ['4']])
    expect(layout.nodes.find((n) => n.id === '3')?.branch).toBe(true)
    expect(layout.nodes.find((n) => n.id === '4')?.branch).toBe(true)
    // 3/4 都排在 2 的下方
    const pos2 = layout.nodes.find((n) => n.id === '2')!.pos
    const pos3 = layout.nodes.find((n) => n.id === '3')!.pos
    expect(pos3.top).toBeGreaterThan(pos2.top + pos2.height)
    expect(f.orphanIds).toEqual([])
  })

  it('链内再分叉：嵌套 subGroups 随列递归摆放，列中心围绕嵌套 owner 对称展开', () => {
    setActivePinia(createPinia())
    const f = useFlowStore()
    f.loadFromSource(
      { sourceId: '430016824', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C' } as never,
      [mk('1', ['0']), mk('2', ['1']), mk('3', ['2']), mk('4', ['2']), mk('5', ['3']), mk('6', ['3']), mk('7', ['5'])],
    )
    const layout = f.layout
    // 分叉点：主链到 2 为止，3/4 各成一列；3 的子树（5/6/7）在嵌套组里
    expect(f.main.includes('3')).toBe(false)
    expect(layout.fanOutColMeta['2']).toBeDefined()
    expect(layout.fanOutColMeta['3']).toBeDefined()
    expect(layout.fanOutColMeta['3'].branches.map((b) => b.chain)).toEqual([['5', '7'], ['6']])
    // 嵌套列里的节点都是 branch 渲染
    for (const id of ['5', '6', '7']) expect(layout.nodes.find((n) => n.id === id)?.branch).toBe(true)
    // 5/6 位于 3 正下方
    const pos3 = layout.nodes.find((n) => n.id === '3')!.pos
    const pos5 = layout.nodes.find((n) => n.id === '5')!.pos
    const pos6 = layout.nodes.find((n) => n.id === '6')!.pos
    expect(pos5.top).toBeGreaterThan(pos3.top + pos3.height)
    expect(pos6.top).toBeGreaterThan(pos3.top + pos3.height)
    // 嵌套列中心围绕 3 的列中心左右对称（NODE_W=210，colGap=32 → 半宽 105 + 16 = 121）
    const cx3 = pos3.left + 105
    const cx5 = pos5.left + 105
    const cx6 = pos6.left + 105
    expect(cx5).toBe(cx3 - 121)
    expect(cx6).toBe(cx3 + 121)
    // 5 → 7 的链内连线存在
    expect(layout.fanOutEdges.some((e) => e.d.includes(`L${cx5} ${layout.nodes.find((nn) => nn.id === '7')!.pos.top}`))).toBe(true)
    expect(f.orphanIds).toEqual([])
  })

  it('孤儿标记随步骤加载进布局节点（5 挂在孤儿 3 下，只有 3 自己打徽标）', () => {
    setActivePinia(createPinia())
    const f = useFlowStore()
    f.loadFromSource(
      { sourceId: '430016824', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C' } as never,
      [mk('1', ['0']), mk('3', ['99999']), mk('4', ['99999']), mk('5', ['3'])],
    )
    expect(f.orphanIds.sort()).toEqual(['3', '4'])
    expect(f.layout.nodes.find((n) => n.id === '3')?.orphan).toBe(true)
    expect(f.layout.nodes.find((n) => n.id === '4')?.orphan).toBe(true)
    expect(f.layout.nodes.find((n) => n.id === '5')?.orphan).toBeFalsy()
    // 入口根不标
    expect(f.layout.nodes.find((n) => n.id === '1')?.orphan).toBeFalsy()
  })
})

// 0925 视觉修复的布局不变量（防回归）：节点两两不重叠、不越出画布、连线端点贴合节点、
// 连线不穿过无关节点。曾经的缺陷是嵌套分叉列与兄弟列重叠 97px、列顶到 left=-11 被裁切、
// 汇聚线从嵌套 owner 底边直拉穿过自己的子列节点。
describe('画布布局不变量（0925 视觉修复）', () => {
  const mk = (stepId: string, dependsOn: string[]) =>
    ({ stepId, sourceId: '1', name: `n${stepId}`, dependsOn, inputTable: '900', outputTable: '900', enabled: true }) as Step
  const SOURCE = { sourceId: '1', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C' } as never

  /** 采样 path（M/L/C）→ 点集 */
  function samplePath(d: string): Array<[number, number]> {
    const pts: Array<[number, number]> = []
    let cur: [number, number] = [0, 0]
    for (const t of d.match(/[MLCQ][^MLCQ]*/g) ?? []) {
      const v = t.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number)
      if (t[0] === 'M') { cur = [v[0], v[1]]; pts.push(cur) }
      else if (t[0] === 'L') { cur = [v[0], v[1]]; pts.push(cur) }
      else if (t[0] === 'Q') {
        // 0925 直角折线的倒圆角：二次贝塞尔（x1 y1 x y）
        const [qx, qy, x, y] = v
        for (let i = 1; i <= 8; i++) {
          const u = i / 8, m = 1 - u
          pts.push([m * m * cur[0] + 2 * m * u * qx + u * u * x, m * m * cur[1] + 2 * m * u * qy + u * u * y])
        }
        cur = [x, y]
      }
      else {
        const [x1, y1, x2, y2, x, y] = v
        for (let i = 1; i <= 20; i++) {
          const u = i / 20, m = 1 - u
          pts.push([
            m ** 3 * cur[0] + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u ** 3 * x,
            m ** 3 * cur[1] + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u ** 3 * y,
          ])
        }
        cur = [x, y]
      }
    }
    return pts
  }

  function assertLayoutSane(layout: ReturnType<typeof useFlowStore>['layout']) {
    const rects = [
      ...layout.nodes.map((n) => ({ id: n.id, left: n.pos.left, top: n.pos.top, width: 210, height: n.pos.height })),
      ...layout.terminals.map((t) => ({ id: t.id, left: t.pos.left, top: t.pos.top, width: 150, height: t.pos.height })),
    ]
    // ① 不越界（曾经嵌套列 left=-11 被裁切）
    for (const r of rects) {
      expect(r.left, `节点 ${r.id} 左越界`).toBeGreaterThanOrEqual(0)
      expect(r.left + r.width, `节点 ${r.id} 右越界`).toBeLessThanOrEqual(layout.width)
    }
    // ② 两两不重叠（曾经嵌套列与兄弟列叠 97px）
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j]
        const overlapX = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
        const overlapY = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
        expect(overlapX > 1 && overlapY > 1, `节点 ${a.id} 与 ${b.id} 重叠`).toBe(false)
      }
    }
    // ③ 连线端点贴合某个节点、且不穿过无关节点
    const edges = [...layout.mainEdges, ...layout.branchEdges, ...layout.fanOutEdges]
    const near = (p: [number, number]) => rects.some((r) =>
      p[0] >= r.left - 6 && p[0] <= r.left + r.width + 6 && p[1] >= r.top - 6 && p[1] <= r.top + r.height + 6)
    const inside = (p: [number, number], r: (typeof rects)[number]) =>
      p[0] > r.left + 2 && p[0] < r.left + r.width - 2 && p[1] > r.top + 2 && p[1] < r.top + r.height - 2
    for (const e of edges) {
      const pts = samplePath(e.d)
      expect(pts.length, `边 ${e.d} 采样为空`).toBeGreaterThan(1)
      expect(near(pts[0]), `边起点悬空 ${e.d}`).toBe(true)
      expect(near(pts[pts.length - 1]), `边终点悬空 ${e.d}`).toBe(true)
      const hits = rects.filter((r) => pts.some((p) => inside(p, r)))
      // 正常连线只贴端点节点的边缘，不应穿过任何节点内部（曾经汇聚线穿过自己的子列节点）
      expect(hits.length, `边穿过节点 ${hits.map((h) => h.id).join(',')}：${e.d}`).toBe(0)
    }
  }

  it('三层嵌套分叉：不重叠、不越界、连线端点贴合且不穿框', () => {
    setActivePinia(createPinia())
    const f = useFlowStore()
    f.loadFromSource(SOURCE, [
      mk('1', ['0']), mk('2', ['1']),
      mk('3', ['2']), mk('4', ['2']),
      mk('5', ['3']), mk('6', ['3']),
      mk('7', ['5']), mk('9', ['7']),
      mk('8', ['4']),
      mk('10', ['9', '8']),
    ])
    // 嵌套组让画布比原型 640 更宽
    expect(f.layout.width).toBeGreaterThan(640)
    assertLayoutSane(f.layout)
  })

  it('纯直链 + 单分支：宽度保持原型 640，主链居中', () => {
    setActivePinia(createPinia())
    const f = useFlowStore()
    f.loadFromSource(SOURCE, [mk('1', ['0']), mk('2', ['1']), mk('3', ['2'])])
    expect(f.layout.width).toBe(640)
    expect(f.layout.axisX).toBe(320)
    assertLayoutSane(f.layout)
  })

  it('三层嵌套分叉的收拢线从子树最深节点出发（不再从嵌套 owner 底边直拉）', () => {
    setActivePinia(createPinia())
    const f = useFlowStore()
    f.loadFromSource(SOURCE, [
      mk('1', ['0']), mk('2', ['1']),
      mk('3', ['2']), mk('4', ['2']),
      mk('5', ['3']), mk('6', ['3']),
      mk('7', ['5']), mk('9', ['7']),
      mk('8', ['4']),
      mk('10', ['9', '8']),
    ])
    const layout = f.layout
    const pos9 = layout.nodes.find((n) => n.id === '9')!.pos
    const deep = `M${pos9.left + 105} ${pos9.top + pos9.height}`
    expect(layout.fanOutEdges.some((e) => e.d.startsWith(deep))).toBe(true)
  })
})

// 1008-BR-03：拓扑编辑统一「改父子关系 → topologyFromParents 重建」，与刷新还原同一套口径。
describe('拓扑编辑：新建分支 / 线上插入 / 分叉前插入（1008-BR-03）', () => {
  const mk = (stepId: string, dependsOn: string[]): Step => ({
    stepId, sourceId: '430016824', name: `n${stepId}`, dependsOn, inputTable: '900', outputTable: '900', enabled: true,
  } as Step)
  const load = (steps: Step[]) => {
    setActivePinia(createPinia())
    const f = useFlowStore()
    f.loadFromSource(
      { sourceId: '430016824', name: 't', url: 'http://x', configId: 'X', mainTable: '900', owner: 'a', state: 'C' } as never,
      steps,
    )
    return f
  }
  const chains = (f: ReturnType<typeof useFlowStore>, owner: string) =>
    f.branchGroups.find((g) => g.ownerId === owner)?.branches.map((b) => b.chain)

  it('addSibling：直链 1→2→3 在 2 旁加兄弟，1 处分叉，新节点排最右，2→3 原样进分支 1', () => {
    const f = load([mk('1', ['0']), mk('2', ['1']), mk('3', ['2'])])
    const n = f.addSibling('2', 'web')!
    expect(f.main).toEqual(['start', '1', 'end'])
    expect(chains(f, '1')).toEqual([['2', '3'], [n]])
    expect(f.parentOfNode(n)).toBe('1')
    expect(f.selectedId).toBe(n)
  })

  it('addSibling：已有分叉时再加一路，排在同级最右', () => {
    const f = load([mk('1', ['0']), mk('2', ['1']), mk('3', ['1'])])
    const n = f.addSibling('2', 'web')!
    expect(chains(f, '1')).toEqual([['2'], ['3'], [n]])
  })

  it('addSibling：根位节点（没有上级）不能加兄弟', () => {
    const f = load([mk('1', ['0']), mk('2', ['1'])])
    expect(f.addSibling('1', 'web')).toBeNull()
  })

  it('insertOnEdge：分支段插入只接管该分支链头，其他分支不动', () => {
    const f = load([mk('1', ['0']), mk('2', ['1']), mk('3', ['1']), mk('4', ['3'])])
    const n = f.insertOnEdge('1', ['3'], 'web')
    expect(f.parentOfNode(n)).toBe('1')
    expect(f.parentOfNode('3')).toBe(n)
    expect(f.parentOfNode('2')).toBe('1')
    // 新节点按「同级最右」排：刷新后后端按步骤 ID 升序，新建的 ID 最大
    expect(chains(f, '1')).toEqual([['2'], [n, '3', '4']])
  })

  it('insertOnEdge 插在最左那一支：这一支挪到最右，与刷新后后端按步骤 ID 升序的顺序一致（217 实测）', () => {
    const f = load([mk('1', ['0']), mk('2', ['1']), mk('3', ['1'])])
    const n = f.insertOnEdge('1', ['2'], 'web')
    expect(chains(f, '1')).toEqual([['3'], [n, '2']])
  })

  it('insertAfter(分叉点)：新节点接管全部子节点 = 在分叉之前插入', () => {
    const f = load([mk('1', ['0']), mk('2', ['1']), mk('3', ['1'])])
    const n = f.insertAfter('1', 'web')
    expect(f.main).toEqual(['start', '1', n, 'end'])
    expect(chains(f, n)).toEqual([['2'], ['3']])
  })

  it('insertAfter(分支链里的节点)：插在链内，不再被追加到主链末尾', () => {
    const f = load([mk('1', ['0']), mk('2', ['1']), mk('3', ['1']), mk('4', ['3'])])
    const n = f.insertAfter('3', 'web')
    expect(f.main).toEqual(['start', '1', 'end'])
    expect(chains(f, '1')).toEqual([['2'], ['3', n, '4']])
  })

  it("insertAfter('start')：新节点当根，原首节点挂到它下面", () => {
    const f = load([mk('1', ['0']), mk('2', ['1'])])
    const n = f.insertAfter('start', 'web')
    expect(f.main).toEqual(['start', n, '1', '2', 'end'])
  })

  it('childrenOfNode：按展示顺序返回直接子节点', () => {
    const f = load([mk('1', ['0']), mk('2', ['1']), mk('3', ['1']), mk('4', ['3'])])
    expect(f.childrenOfNode('1')).toEqual(['2', '3'])
    expect(f.childrenOfNode('3')).toEqual(['4'])
    expect(f.childrenOfNode('4')).toEqual([])
  })
})
