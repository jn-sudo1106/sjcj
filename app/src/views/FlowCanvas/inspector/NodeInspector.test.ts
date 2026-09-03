// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import NodeInspector from './NodeInspector.vue'
import EditParamSourceDialog from '@/views/FlowCanvas/source/EditParamSourceDialog.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { configApi, entryApi, paramApi, ruleApi, sourceApi } from '@/api'
import { ElMessage } from 'element-plus'

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
  it('采集节点显示配置绑定条：有 configId 标「已有配置」，没有则标「新建配置 · 未保存」，旁边有「更换」入口', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '6200026' }
    flow.configs['web-2'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    const bar = w.find('.rc-config-bar')
    expect(bar.exists()).toBe(true)
    expect(w.text()).toContain('#6200026')
    expect(w.text()).toContain('已有配置')
    // 换配置的入口在配置条上（0828 §2.1-2b：保持原样式，旁边加轻量入口）
    expect(bar.find('[data-testid="node-config-select"]').exists()).toBe(true)

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

    // 没有 configId 的节点点保存：不发任何写请求。
    // updateConfig 不带 configId 并不会创建配置（2026-08-28 实测），copyAll 又需要可复制的源配置，
    // 所以这种节点只能先「选择已有配置」。
    const update = vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: 'ok' })
    const copy = vi.spyOn(configApi, 'copyConfigAndLocate')
    const saveBtn = w.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
    await saveBtn.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()
    // 没写成，脏标保持
    expect(flow.configDirty).toBe(true)
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
    const saveOf = () => w.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
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

describe('配置名称跟随节点名，不在节点配置 Tab 填写', () => {
  it('面板不展示配置名称输入；名称只出现在当前配置条', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    expect(w.find('.rc-inspector-body').text()).not.toContain('配置名称')
    expect(w.find('.rc-inspector-body [aria-label="配置名称"]').exists()).toBe(false)
    // 源 URL 不在节点配置 Tab；配置自己的 URL（旧平台「配置编辑」）在
    expect(w.find('.rc-inspector-body').text()).not.toContain('源 URL')
    expect(w.find('.rc-inspector-body [aria-label="URL"]').exists()).toBe(true)

    flow.setConfigName('web-1', '公告列表配置')
    await flushPromises()
    expect(w.find('.rc-config-bar').text()).toContain('公告列表配置')
    w.unmount()
  })

  it('保存时配置名为空则用节点名补上，不再提示填写配置名称', async () => {
    mockAssets()
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({ clearRule: '{"keep":1}' })
    const update = vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: 'ok' })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '1400774' }
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    flow.setDedupMode('web-1', 'table')
    await flushPromises()

    const saveBtn = () => w.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
    await saveBtn().trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({
      configId: '1400774',
      configName: '公告列表抓取',
    })
    expect(flow.configs['web-1'].configName).toBe('公告列表抓取')
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

// 2026-08-28（0828 §6.2）：保存前的影响范围确认**删掉了**——会上原话「正常保存就保存了，不要有提示」。
// 影响范围降级成保存按钮旁的一行灰字「N 个源在用」，独占（1 个源）时连这行都不显示。
// 本组用例随之从「先弹窗、确认才写」改成「直接写」，并新增灰字的两个断言。
describe('保存已有配置：直接落库 + 使用范围灰字（0828 §6.2）', () => {
  it('有 configId 时点保存直接发 updateConfig，不弹任何确认', async () => {
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

    // 置脏即查使用范围，并把「337 个源在用」挂在保存按钮旁（不拦截）
    expect(sourceApi.sourcePaged).toHaveBeenCalledWith(expect.objectContaining({ configId: '1400774' }))
    expect(w.find('[data-testid="config-usage-note"]').text()).toBe('337 个源在用')

    const saveBtn = w.findAll('.rc-insp-foot .rc-btn').find((b) => b.text() === '保存')!
    await saveBtn.trigger('click')
    await flushPromises()
    await flushPromises()

    // 一次点击直接写库，且带上原始记录里的 BLOB 字段
    expect(detailRaw).toHaveBeenCalledWith('1400774')
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({ configId: '1400774', clearRule: '{"keep":1}', snatchDrepeat: 'ALL' })
    expect(flow.configDirty).toBe(false)
    w.unmount()
  })

  it('独占配置（只有 1 个源在用）不显示使用范围灰字', async () => {
    mockAssets()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [] as never })
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({})
    vi.spyOn(configApi, 'updateConfig').mockResolvedValue({ ok: true, message: '操作成功' })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '1400900', configName: '独占配置' }
    flow.select('web-1')

    const w = mount(NodeInspector)
    await flushPromises()
    flow.setDedupMode('web-1', 'table')
    await flushPromises()
    expect(w.find('[data-testid="config-usage-note"]').exists()).toBe(false)
    w.unmount()
  })
})

describe('规则节点保存前校验', () => {
  it('出参字段为空时提示勾选，并停留在表配置且不发保存请求', async () => {
    mockAssets()
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close: () => {} }))
    const create = vi.spyOn(configApi, 'addConfig')
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const cfg = cloneConfig(NODE_CONFIGS.rule)
    cfg.ruleCfg = {
      ...cfg.ruleCfg!,
      inputTableId: '2102154',
      inputFields: ['sku_id'],
      outputFields: [],
    }
    flow.configs['rule-1'] = cfg
    flow.select('rule-1')
    flow.setActiveTab('config')

    const wrapper = mount(NodeInspector)
    await flushPromises()
    await wrapper.get('.rc-insp-foot .rc-btn.primary').trigger('click')
    await flushPromises()

    expect(warning).toHaveBeenCalledWith('请至少选择 1 个出参字段')
    expect(flow.activeTab).toBe('table')
    expect(create).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

// 结构化配置空着时直接给出旧「配全局ID」模板，不再单独放按钮。
describe('结构化配置默认全局ID模板', () => {
  async function openTableTab(structuredConfig?: string) {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.configName = '公告列表配置'
    if (structuredConfig !== undefined) cfg.collectCfg!.structuredConfig = structuredConfig
    flow.configs['web-1'] = cfg
    flow.select('web-1')
    const w = mount(NodeInspector)
    await flushPromises()
    flow.setActiveTab('table')
    await flushPromises()
    return { flow, w }
  }

  it('空值时输入框直接是全局ID模板，没有「配全局ID」按钮', async () => {
    const { flow, w } = await openTableTab()
    const ta = w.findAll('textarea').find((t) => t.attributes('placeholder')?.includes('globals'))!
    expect(ta.element.value).toBe('{"globals":["列ID"]}')
    expect(w.findAll('button').some((b) => b.text() === '配全局ID')).toBe(false)
    expect(flow.configs['web-1'].collectCfg?.structuredConfig).toBeUndefined()
    expect(flow.configDirty).toBe(false)
    w.unmount()
  })

  it('已有内容时显示原值，不换成模板', async () => {
    const { w } = await openTableTab('{"mine":1}')
    const ta = w.findAll('textarea').find((t) => t.attributes('placeholder')?.includes('globals'))!
    expect(ta.element.value).toBe('{"mine":1}')
    w.unmount()
  })
})
