// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NodeInspector from './NodeInspector.vue'
import EditParamSourceDialog from '@/views/FlowCanvas/source/EditParamSourceDialog.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { configApi, entryApi, paramApi, ruleApi, sourceApi } from '@/api'

function mockAssets() {
  vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'ruleGroups').mockResolvedValue([])
  vi.spyOn(ruleApi, 'rulePaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'sharedConfigs').mockResolvedValue([])
}

// review 0723 #9 修正：文档原描述（onMounted 无条件加载 6 个 API）已经不成立，当前代码已有 isRule 判断；
// 但 NodeInspector 只 mount 一次、isRule 只在那一次 onMounted 判断，导致真实问题更严重——
// 打开画布时若没恰好选中规则节点，规则相关数据会永远加载不出来。这里验证懒加载 + 响应式补拉的修复。
afterEach(() => vi.restoreAllMocks())

describe('NodeInspector 规则数据懒加载（review 0723 #9 修正）', () => {
  it('打开画布选中非规则节点：规则相关 3 个 API 不调用；之后切到规则节点才补拉，且只拉一次', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
    flow.configs['rule-2'] = cloneConfig(NODE_CONFIGS['rule'])
    flow.select('web-1')

    mount(NodeInspector)
    await flushPromises()

    expect(ruleApi.ruleGroups).not.toHaveBeenCalled()
    expect(ruleApi.rulePaged).not.toHaveBeenCalled()
    expect(ruleApi.sharedConfigs).not.toHaveBeenCalled()

    flow.select('rule-1')
    await flushPromises()

    expect(ruleApi.ruleGroups).toHaveBeenCalledTimes(1)
    expect(ruleApi.rulePaged).toHaveBeenCalledTimes(1)
    expect(ruleApi.sharedConfigs).toHaveBeenCalledTimes(1)

    // 切到另一个规则节点：数据已经拉过，不重复请求
    flow.select('rule-2')
    await flushPromises()
    expect(ruleApi.ruleGroups).toHaveBeenCalledTimes(1)
  })

  it('打开画布时就选中规则节点：mount 时直接拉规则数据', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
    flow.select('rule-1')

    mount(NodeInspector)
    await flushPromises()

    expect(ruleApi.ruleGroups).toHaveBeenCalledTimes(1)
  })
})

// 参数源的 urlTemplate 只灌给主链首个采集节点（flowModel.applyParamSourceUrlToFirstCollectNode），
// 之前「参数配置」tab 的展示条件只看 isParamSource（源级），导致非首个采集节点也误展示参数源摘要，
// 挡掉了它自己本该有的 UrlParamEditor（节点级单值绑定）入口。这里验证按 isFirstCollectorNode 收窄后的展示。
// 0802 重构·方案 A：参数源编辑入口整体挪到 ConfigTab 源 URL 区，ParamsTab 不再重复展示摘要/跳转按钮；
// 仅在「非首个采集节点 + 是参数源」时给一行提示，避免用户误以为本节点能编辑参数源。
// 0804 拍板（决议 D17）曾把「参数配置」tab 对全部节点隐藏；0805 改判（推翻 D17）恢复非规则节点的入口——
// 下面 setActiveTab('params') 的两个用例随之恢复。
describe('NodeInspector 参数源编辑入口在 ConfigTab（0802 重构）', () => {
  function setupParamSource() {
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.sourceCfg = {
      sourceId: 's-1', name: '参数源', url: '', configId: '', mainTable: 'T1', owner: 'admin', state: 'C',
      kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913',
      paramRefs: [{ paramId: '913', group: null }],
    }
    const first = cloneConfig(NODE_CONFIGS['web-list'])
    if (first.collectCfg) first.collectCfg.url = 'http://base-$PARAM$_913'
    const second = cloneConfig(NODE_CONFIGS['web-list'])
    flow.main = ['web-1', 'web-2']
    flow.configs['web-1'] = first
    flow.configs['web-2'] = second
    return flow
  }

  it('首个采集节点 + 是参数源：ParamsTab 不展示「非首个」提示，照常展示 UrlParamEditor（URL 取自参数源）', async () => {
    mockAssets()
    const flow = setupParamSource()
    flow.select('web-1')
    flow.setActiveTab('params')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    // 编辑入口在 ConfigTab：ParamsTab 没有任何「去配置」按钮或摘要块
    expect(wrapper.find('[data-testid="params-jump-to-config"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('去「配置」编辑参数源')
    // 首节点：URL 由参数源管理，不展示「本源为参数源…本节点的 URL 参数按下方单独配置」的非首节点提示
    expect(wrapper.text()).not.toContain('本源为参数源')
    // 节点级 UrlParamEditor 仍展示，URL 由 applyParamSourceUrlToFirstCollectNode 同步进 cc.url
    expect(wrapper.find('.upe').exists()).toBe(true)
    // 源级 urlTemplate 已被灌进首节点 cc.url，UrlParamEditor 拿到的 url prop 应当带 $PARAM$_913
    const upeUrl = (wrapper.findComponent({ name: 'UrlParamEditor' }) as any)?.props('url')
      ?? wrapper.find('.upe').attributes('data-url')
    expect(typeof upeUrl === 'string' ? upeUrl : '').toContain('$PARAM$_913')
  })

  it('非首个采集节点：展示提示 + 自己的 UrlParamEditor，不展示参数源摘要/跳转按钮', async () => {
    mockAssets()
    const flow = setupParamSource()
    flow.select('web-2')
    flow.setActiveTab('params')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    expect(wrapper.text()).toContain('本源为参数源')
    expect(wrapper.find('[data-testid="params-jump-to-config"]').exists()).toBe(false)
    expect(wrapper.find('.upe').exists()).toBe(true)
  })

  it('首个采集节点 + 切到「配置」tab：源 URL 下方挂载只读摘要 + 「编辑」按钮（0803 调整，不再默认可编辑）', async () => {
    mockAssets()
    const flow = setupParamSource()
    flow.select('web-1')
    flow.setActiveTab('config')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    // 默认只读：无「选择已有参数」等编辑态操作，模板为只读展示
    expect(wrapper.find('[data-testid="param-source-pick"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="param-source-template"]').exists()).toBe(false)
    expect(wrapper.find('.ssw-readonly-template').exists()).toBe(true)
    // 「编辑」按钮打开 EditParamSourceDialog（弹窗内才是可编辑态）
    const editBtn = wrapper.find('[data-testid="param-source-edit-open"]')
    expect(editBtn.exists()).toBe(true)
    expect(wrapper.find('[data-testid="edit-param-source-save"]').exists()).toBe(false)
    await editBtn.trigger('click')
    expect(wrapper.find('[data-testid="edit-param-source-save"]').exists()).toBe(true)
  })

  it('非首个采集节点 + 切到「配置」tab：源 URL 下方不挂载参数源摘要', async () => {
    mockAssets()
    const flow = setupParamSource()
    flow.select('web-2')
    flow.setActiveTab('config')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    expect(wrapper.find('[data-testid="param-source-edit-open"]').exists()).toBe(false)
  })

  it('非参数源 + 首个采集节点 + 切到「配置」tab：源 URL 下方也不挂载参数源摘要', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.sourceCfg = {
      sourceId: 's-2', name: '普通源', url: 'http://x.com', configId: '', mainTable: 'T1', owner: 'admin', state: 'C',
      // kind 缺省 = 'normal'
    }
    const first = cloneConfig(NODE_CONFIGS['web-list'])
    flow.main = ['web-1']
    flow.configs['web-1'] = first
    flow.select('web-1')
    flow.setActiveTab('config')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    expect(wrapper.find('[data-testid="param-source-edit-open"]').exists()).toBe(false)
  })

  // REVIEW-2026-08-04 P2 #6：从 ConfigTab 走完整保存链路——点「编辑」→ 弹窗出现 → 改 urlTemplate → 保存
  // → sourceApi.sourceUpdate 落库 + flow.sourceCfg 同步 + 首节点 cc.url 同步 + 弹窗关 + 只读摘要刷新。
  // ParamSourceEditor 在 ConfigTab 只读区也用（同一组件、readonly 模式），没法整个 stub 掉，否则
  // 只读摘要也被搞没；改为不 mount ElementPlus、绕开 ParamSourceEditor 真实渲染：
  // 直接调 dialog 的 save + 改 dialog 内部的 draft（拿到 ref 后改 .value，defineModel 双向绑定的写法）。
  it('ConfigTab 点编辑 → 改 urlTemplate → 保存：sourceUpdate 落库 + sourceCfg/首节点/只读摘要全部同步', async () => {
    mockAssets()
    vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true, message: '已保存' })
    const flow = setupParamSource()
    flow.select('web-1')
    flow.setActiveTab('config')

    const wrapper = mount(NodeInspector)
    await flushPromises()

    // 保存前：只读摘要展示旧 urlTemplate
    const readonlyTpl = () => wrapper.get('.ssw-readonly-template').text()
    expect(readonlyTpl()).toContain('http://base-$PARAM$_913')

    // 点编辑 → 弹窗出现
    await wrapper.get('[data-testid="param-source-edit-open"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="edit-param-source-save"]').exists()).toBe(true)

    // 拿 EditParamSourceDialog 组件实例，直接改其内部 draft ref 的值
    // （defineModel 双向绑定的契约：用 .value = 改，外部 v-model 同步生效）
    const dialog = wrapper.findComponent(EditParamSourceDialog)
    expect(dialog.exists()).toBe(true)
    ;(dialog.vm as any).draft = {
      baseUrl: 'http://new-base',
      urlTemplate: 'http://new-base-$PARAM$_913',
      refs: [{ paramId: '913', group: null }],
    }
    await flushPromises()

    // 点保存
    await wrapper.get('[data-testid="edit-param-source-save"]').trigger('click')
    await flushPromises()

    // 1) sourceUpdate 落库，传新模板
    expect(sourceApi.sourceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 's-1',
      baseUrl: 'http://new-base',
      urlTemplate: 'http://new-base-$PARAM$_913',
    }))

    // 2) flow.sourceCfg 同步新模板
    expect(flow.sourceCfg?.urlTemplate).toBe('http://new-base-$PARAM$_913')
    expect(flow.sourceCfg?.baseUrl).toBe('http://new-base')

    // 3) 首节点 cc.url 同步（patchSource → applyParamSourceUrlToFirstCollectNode）
    expect(flow.configs['web-1'].collectCfg?.url).toBe('http://new-base-$PARAM$_913')

    // 4) 弹窗关闭 + 5) 只读摘要刷新
    expect(wrapper.find('[data-testid="edit-param-source-save"]').exists()).toBe(false)
    expect(readonlyTpl()).toContain('http://new-base-$PARAM$_913')
    expect(readonlyTpl()).not.toContain('http://base-$PARAM$_913')
  })
})

describe('配置绑定条与节点配置脏状态条（0824-00 §5.4/§6.1）', () => {
  it('采集节点显示配置绑定条：有 configId 标「已有配置」，没有则标「新建配置 · 未保存」', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '6200026' }
    flow.configs['web-2'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    expect(w.find('.rc-config-bar').exists()).toBe(true)
    expect(w.text()).toContain('#6200026')
    expect(w.text()).toContain('已有配置')

    flow.select('web-2')
    await flushPromises()
    expect(w.text()).toContain('新建配置 · 未保存')
    w.unmount()
  })

  it('决策节点不参与配置绑定，不显示配置条', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['dec-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), kind: 'decision' }
    flow.select('dec-1')

    const w = mount(NodeInspector)
    await flushPromises()
    expect(w.find('.rc-config-bar').exists()).toBe(false)
    w.unmount()
  })

  it('改节点配置置脏；保存配置后清脏标并把流程置脏', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configName: '公告列表配置' }
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    expect(w.find('.rc-insp-foot').exists()).toBe(true)

    flow.setDedupMode('web-1', 'table')
    await flushPromises()
    expect(w.text()).toContain('节点配置有未保存修改')

    // 没有 configId 的节点，「保存配置」走新建（updateConfig 不带 configId），打桩到位再点
    vi.spyOn(configApi, 'createConfig').mockResolvedValue({ ok: true, configId: '900001', message: undefined })
    vi.spyOn(configApi, 'configDetail').mockResolvedValue({ configId: '900001', name: '公告列表配置', enabled: true })
    const saveBtn = w.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存配置')!
    await saveBtn.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(w.text()).toContain('无未保存修改')
    expect(flow.configDirty).toBe(false)
    expect(flow.flowDirty).toBe(true)
    w.unmount()
  })

  it('底部条常驻：未改动的已有配置节点也在，保存按钮禁用；新建配置态可直接保存（§5.3）', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '1400774', configName: '公告列表配置' }
    flow.configs['web-2'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configName: '新配置' }
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    const saveOf = () => w.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存配置')!
    expect(w.text()).toContain('无未保存修改')
    expect(saveOf().attributes('disabled')).toBeDefined()

    // 新建配置态：一个字段没改也要能保存一次（§5.3 首次保存才拿 configId）
    flow.select('web-2')
    await flushPromises()
    expect(w.text()).toContain('新建配置 · 未保存')
    expect(saveOf().attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('决策节点不显示节点配置脏状态条', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['dec-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), kind: 'decision' }
    flow.select('dec-1')

    const w = mount(NodeInspector)
    await flushPromises()
    expect(w.find('.rc-insp-foot').exists()).toBe(false)
    w.unmount()
  })
})

describe('配置名称必填与 AI 对话 Tab（0824-06 §4）', () => {
  it('配置名称只在保存那一刻校验：面板不打星号、按钮不禁用，点了才提示', async () => {
    mockAssets()
    const update = vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: 'ok' })
    const create = vi.spyOn(configApi, 'createConfig').mockResolvedValue({ ok: true, configId: '1', message: undefined })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    // 面板上没有必填星号，也没有常驻红字提示
    expect(w.text()).not.toContain('配置名称必填')
    expect(w.find('.rc-inspector-body').text()).not.toContain('配置名称 *')

    // 名称为空时按钮可点，但点了不发请求
    const saveBtn = () => w.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存配置')!
    expect(saveBtn().attributes('disabled')).toBeUndefined()
    await saveBtn().trigger('click')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()

    flow.setConfigName('web-1', '公告列表配置')
    await flushPromises()
    // 配置绑定条同步显示配置名称
    expect(w.find('.rc-config-bar').text()).toContain('公告列表配置')
    w.unmount()
  })

  it('AI 对话 Tab 下不显示保存配置条', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configName: '公告列表配置' }
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    expect(w.find('.rc-insp-foot').exists()).toBe(true)

    flow.setActiveTab('ai')
    await flushPromises()
    expect(w.find('.rc-insp-foot').exists()).toBe(false)
    w.unmount()
  })
})

describe('保存已有配置的影响范围确认（0824-00 §2.2，源维度）', () => {
  it('有 configId 时点保存不直接写库，先弹影响范围；确认后才发 updateConfig', async () => {
    mockAssets()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({
      total: 337,
      list: [
        { sourceId: '430016501', name: '多彩贵州网-金融-金融理财', configId: '1400774' },
        { sourceId: '430016502', name: '多彩贵州网-金融-其它', configId: '1400935' },
      ] as never,
    })
    const detailRaw = vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({ clearRule: '{"keep":1}' })
    const update = vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: '操作成功' })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '1400774', configName: '公告列表配置' }
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    flow.setDedupMode('web-1', 'table')
    await flushPromises()

    const saveBtn = w.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存配置')!
    await saveBtn.trigger('click')
    await flushPromises()
    // 只开弹窗，没写库
    expect(update).not.toHaveBeenCalled()
    expect(sourceApi.sourcePaged).toHaveBeenCalledWith(expect.objectContaining({ configId: '1400774' }))

    // 确认后才写，且带上原始记录里的 BLOB 字段
    const dialog = w.findComponent({ name: 'SaveSharedConfigDialog' })
    dialog.vm.$emit('confirm')
    await flushPromises()
    await flushPromises()
    expect(detailRaw).toHaveBeenCalledWith('1400774')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({ configId: '1400774', clearRule: '{"keep":1}', snatchDrepeat: 'ALL' })
    expect(flow.configDirty).toBe(false)
    w.unmount()
  })
})

// 旧平台在「结构化配置」旁挂了个一键填模板（旧前端 column.config.js:599 的 more/callback）：
// 图标是问号，点下去其实往表单写 {"globals":["列ID"]}。我们做成显式按钮，不照抄那个坑。
describe('结构化配置「配全局ID」一键填模板', () => {
  async function openTableTab() {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configName: '公告列表配置' }
    flow.select('web-1')
    const w = mount(NodeInspector)
    await flushPromises()
    flow.setActiveTab('table')
    await flushPromises()
    return { flow, w }
  }

  it('空值时点一下填入全局ID模板', async () => {
    const { flow, w } = await openTableTab()
    const btn = w.findAll('button').find((b) => b.text() === '配全局ID')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    expect(flow.configs['web-1'].collectCfg?.structuredConfig).toBe('{"globals":["列ID"]}')
    w.unmount()
  })

  it('已有内容时不覆盖', async () => {
    const { flow, w } = await openTableTab()
    flow.setStructuredConfig('web-1', '{"mine":1}')
    await flushPromises()
    const btn = w.findAll('button').find((b) => b.text() === '配全局ID')!
    await btn.trigger('click')
    expect(flow.configs['web-1'].collectCfg?.structuredConfig).toBe('{"mine":1}')
    w.unmount()
  })
})
