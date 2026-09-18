// @vitest-environment jsdom
// 节点配置 Tab：规则节点「选择已有规则」（0805 恢复 D3 砍掉的能力，按会议原话"新建是新建、选是选"
// 分开做——节点名称输入框只管新建/改名，单独一个按钮 + 弹窗管选择，见方案 §1.3）。
// 通过挂载整个 NodeInspector 测试（而非孤立挂载 ConfigTab），因为 useNodeInspectorAssets() 的
// provide/inject 上下文由 NodeInspector 建立，脱离它调用会抛错（见 useNodeInspectorAssets.ts 设计约束）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import NodeInspector from '../NodeInspector.vue'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, paramApi, ruleApi, configApi } from '@/api'
import type { EntryType } from '@/api'

const OUTPUT_TABLE: EntryType = {
  tableId: '2102200', tableName: 'sense_data.TB_EXISTING', name: '既有规则输入表',
  fields: [{ prop: 'sku_id', desc: '商品ID', type: 'string', required: false, columnName: 'K1' }],
}


function mockAssets() {
  vi.spyOn(entryApi, 'entryPaged').mockResolvedValue({ total: 1, list: [OUTPUT_TABLE] })
  vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'ruleGroups').mockResolvedValue([])
  vi.spyOn(ruleApi, 'rulePaged').mockResolvedValue({ total: 0, list: [] })
  vi.spyOn(ruleApi, 'sharedConfigs').mockResolvedValue([])
}

afterEach(() => vi.restoreAllMocks())

function mountOnRuleNode() {
  setActivePinia(createPinia())
  const flow = useFlowStore()
  flow.configs['rule-1'] = cloneConfig(NODE_CONFIGS['rule'])
  flow.select('rule-1')
  flow.setActiveTab('config')
  const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
  return { flow, wrapper }
}

// 「选择已有规则」入口 2026-09-04 已删除（旧规则平台废弃，现在统一走配置），
// 原来那 4 条用例（按钮存在 / 打开弹窗 / 选中回填 / 反查表失败提示）随之删除。
describe('ConfigTab · 规则节点', () => {
  it('规则节点名称允许暂时清空，保存校验再提示必填', async () => {
    const { flow, wrapper } = mountOnRuleNode()
    await flushPromises()

    const titleInput = wrapper.find('input[placeholder="直接输入规则名称"]')
    await titleInput.setValue('')

    expect((titleInput.element as HTMLInputElement).value).toBe('')
    expect(flow.configs['rule-1'].title).toBe('')
  })

  it('规则节点隐藏适用源字段，未设置时默认写入 -1', async () => {
    mockAssets()
    const { flow, wrapper } = mountOnRuleNode()
    flow.configs['rule-1'].itemId = '-1'
    flow.configs['rule-1'].stepSourceId = undefined
    await flushPromises()

    expect(wrapper.find('input[aria-label="适用源"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('适用源')
    expect(flow.configs['rule-1'].stepSourceId).toBe('-1')
    expect(flow.configs['rule-1'].ruleCfg?.ruleId).toBeFalsy()
  })
})

// S4-1（方案 §6.1）：登录节点自己的核心字段（账号/凭据引用）常显，不走采集节点运行设置里已废弃的 needLogin 开关
describe('ConfigTab · 网页登录节点专属字段（S4-1）', () => {
  it('登录节点：显示旧平台登录字段；普通采集节点没有', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['login-1'] = cloneConfig(NODE_CONFIGS['login-collect'])
    flow.select('login-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.find('[data-testid="login-config-add"]').trigger('click')
    expect(wrapper.text()).toContain('登录配置')
    expect(wrapper.find('input[placeholder="登录用户名"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="登录密码"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('凭据引用')

    setActivePinia(createPinia())
    const flow2 = useFlowStore()
    flow2.configs['web-1'] = cloneConfig(NODE_CONFIGS['web-list'])
    flow2.select('web-1')
    flow2.setActiveTab('config')
    const wrapper2 = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper2.text()).not.toContain('登录账号')
    expect(wrapper2.text()).not.toContain('凭据引用')
  })

  it('新增登录配置：写入旧平台字段，并设为默认配置', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['login-1'] = cloneConfig(NODE_CONFIGS['login-collect'])
    flow.select('login-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="login-config-add"]').trigger('click')
    const urlInput = wrapper.find('input[placeholder="登录 URL"]')
    const loginNameInput = wrapper.find('input[placeholder="登录用户名"]')
    const loginPwdInput = wrapper.find('input[placeholder="登录密码"]')
    await urlInput.setValue('https://example.com/login')
    await loginNameInput.setValue('main-user')
    await loginPwdInput.setValue('pwd-001')

    expect(flow.configs['login-1'].collectCfg?.loginConfigs).toEqual([{
      id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'main-user', loginPwd: 'pwd-001', newLoginConfig: '1', authConfig: '', enabled: true,
    }])
    expect(flow.configs['login-1'].collectCfg?.defaultLoginConfigId).toBe('login-1')
  })

  it('新建登录密码允许暂时为空，等待保存校验', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['login-1'] = cloneConfig(NODE_CONFIGS['login-collect'])
    flow.select('login-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="login-config-add"]').trigger('click')
    const passwordInput = wrapper.find('input[placeholder="登录密码"]')
    await wrapper.find('input[placeholder="登录 URL"]').setValue('https://example.com/login')
    await wrapper.find('input[placeholder="登录用户名"]').setValue('main-user')
    await passwordInput.setValue('')

    expect((passwordInput.element as HTMLInputElement).value).toBe('')
    expect(flow.configs['login-1'].collectCfg?.loginConfigs?.[0].loginPwd).toBe('')
    expect(wrapper.find('.login-config-error').text()).toContain('请填写登录密码')
  })

  it('多登录配置：可新增第二条配置并停用其中一条', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['login-1'] = cloneConfig(NODE_CONFIGS['login-collect'])
    flow.select('login-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="login-config-add"]').trigger('click')
    await wrapper.find('input[placeholder="登录 URL"]').setValue('https://example.com/login')
    await wrapper.find('input[placeholder="登录用户名"]').setValue('main-user')
    await wrapper.find('input[placeholder="登录密码"]').setValue('pwd-001')
    await wrapper.find('[data-testid="login-config-add"]').trigger('click')
    const urls = wrapper.findAll('input[placeholder="登录 URL"]')
    const loginNames = wrapper.findAll('input[placeholder="登录用户名"]')
    const passwords = wrapper.findAll('input[placeholder="登录密码"]')
    await urls[1].setValue('https://example.com/login')
    await loginNames[1].setValue('backup-user')
    await passwords[1].setValue('pwd-002')

    const second = flow.configs['login-1'].collectCfg?.loginConfigs?.[1]
    expect(second).toMatchObject({ loginName: 'backup-user', loginPwd: 'pwd-002', newLoginConfig: '1', authConfig: '', enabled: true })
    const toggle = wrapper.get('[data-testid="login-config-enable-login-2"]')
    expect(toggle.attributes('role')).toBe('switch')
    expect(toggle.attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-testid="login-config-status-login-2"]').text()).toContain('已启用')
    await toggle.trigger('click')
    expect(flow.configs['login-1'].collectCfg?.loginConfigs?.[1].enabled).toBe(false)
    expect(flow.configs['login-1'].collectCfg?.defaultLoginConfigId).toBe('login-1')
    expect(wrapper.get('[data-testid="login-config-status-login-2"]').text()).toContain('已停用')
  })

  it('删除登录配置：首个和唯一配置都可删除，删除最后一个时清理旧字段', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['login-1'] = cloneConfig(NODE_CONFIGS['login-collect'])
    flow.configs['login-1'].collectCfg = {
      ...flow.configs['login-1'].collectCfg!,
      account: 'legacy-account',
      loginConfigs: [
        { id: 'login-1', loginUrl: 'https://example.com/login', loginName: 'main-user', loginPwd: 'pwd-001', newLoginConfig: '1', authConfig: '', enabled: true },
        { id: 'login-2', loginUrl: 'https://example.com/login', loginName: 'backup-user', loginPwd: 'pwd-002', newLoginConfig: '1', authConfig: '', enabled: true },
      ],
      defaultLoginConfigId: 'login-1',
    }
    flow.select('login-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    await wrapper.find('[data-testid="login-config-login-1"] .rc-row-del').trigger('click')
    expect(flow.configs['login-1'].collectCfg?.loginConfigs).toEqual([{
      id: 'login-2', loginUrl: 'https://example.com/login', loginName: 'backup-user', loginPwd: 'pwd-002', newLoginConfig: '1', authConfig: '', enabled: true,
    }])
    expect(flow.configs['login-1'].collectCfg?.defaultLoginConfigId).toBe('login-2')

    await wrapper.find('[data-testid="login-config-login-2"] .rc-row-del').trigger('click')
    expect(flow.configs['login-1'].collectCfg?.loginConfigs).toEqual([])
    expect(flow.configs['login-1'].collectCfg?.defaultLoginConfigId).toBeUndefined()
    expect(flow.configs['login-1'].collectCfg?.account).toBe('')
    expect(wrapper.find('.login-config-empty').exists()).toBe(true)
  })
})

// S4-1：定时策略已从首采集节点解绑，节点配置中的独立折叠区对登录和列表节点都存在。
describe('ConfigTab · 节点级定时策略', () => {
  it('登录→列表抓取：定时策略独立展示在两个节点的节点配置中', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.newFlow('standard')
    flow.insertAfter('start', 'login')

    flow.select('web-list')
    flow.setActiveTab('config')
    const webWrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(webWrapper.find('.ni-schedule').exists()).toBe(true)

    const loginId = flow.main.find((id) => flow.configs[id]?.collectCfg?.collectorKind === 'login')!
    flow.select(loginId)
    flow.setActiveTab('config')
    const loginWrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(loginWrapper.find('.ni-schedule').exists()).toBe(true)
  })
})

describe('ConfigTab · 配置 URL 从 config/configDetail 回填', () => {
  it('已有 configId 且节点上还没有 URL 时，读原始记录的 configUrl 填上，不置脏', async () => {
    mockAssets()
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({
      configId: 1400774,
      configName: '证券之星列表配置',
      configUrl: 'http://www.baidu.com',
    })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '1400774', configName: '证券之星列表配置' }
    flow.select('web-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(configApi.configDetailRaw).toHaveBeenCalledWith('1400774')
    expect(flow.configs['web-1'].configUrl).toBe('http://www.baidu.com')
    expect(flow.configDirty).toBe(false)
    expect((wrapper.find('[aria-label="URL"]').element as HTMLInputElement).value).toBe('http://www.baidu.com')
    wrapper.unmount()
  })

  it('节点上已经有配置 URL 时不再请求', async () => {
    mockAssets()
    const detailRaw = vi.spyOn(configApi, 'configDetailRaw')
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = {
      ...cloneConfig(NODE_CONFIGS['web-list']),
      configId: '1400774',
      configName: '证券之星列表配置',
      configUrl: 'http://already.example/',
    }
    flow.select('web-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(detailRaw).not.toHaveBeenCalled()
    expect((wrapper.find('[aria-label="URL"]').element as HTMLInputElement).value).toBe('http://already.example/')
    wrapper.unmount()
  })

  it('节点上配置 URL 还是空字符串时，用详情里的真值补上', async () => {
    mockAssets()
    vi.spyOn(configApi, 'configDetailRaw').mockResolvedValue({
      success: true,
      data: {
        configId: 1400766,
        configName: 'guancha-观察者网-金融科技',
        configUrl: 'https://www.guancha.cn/jinrongkeji',
      },
    })
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['web-1'] = {
      ...cloneConfig(NODE_CONFIGS['web-list']),
      configId: '1400766',
      configName: 'guancha-观察者网-金融科技',
      configUrl: '',
    }
    flow.select('web-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(flow.configs['web-1'].configUrl).toBe('https://www.guancha.cn/jinrongkeji')
    expect(flow.configDirty).toBe(false)
    expect((wrapper.find('[aria-label="URL"]').element as HTMLInputElement).value).toBe('https://www.guancha.cn/jinrongkeji')
    wrapper.unmount()
  })
})

// 2026-09-18：翻译助手的节点配置与规则处理保持一致——只剩「节点名称 + 定时策略」，
// 不再渲染通用的基础字段/参数三元表/发起抓取信息（那些是给自定义/规划中节点兜底的占位内容）。
describe('ConfigTab · 翻译助手（与规则处理同表单）', () => {
  it('只剩节点名称与定时策略，不渲染通用基础字段/参数/发起抓取信息', async () => {
    mockAssets()
    setActivePinia(createPinia())
    const flow = useFlowStore()
    flow.configs['translate-1'] = cloneConfig(NODE_CONFIGS['translate'])
    flow.select('translate-1')
    flow.setActiveTab('config')
    const wrapper = mount(NodeInspector, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(wrapper.text()).toContain('节点名称')
    expect(wrapper.text()).toContain('定时策略')
    expect(wrapper.text()).not.toContain('文本来源')
    expect(wrapper.text()).not.toContain('能力状态')
    expect(wrapper.text()).not.toContain('发起抓取信息')
    expect(wrapper.text()).not.toContain('复制节点')
    expect(wrapper.find('[data-testid="edit-node-source"]').exists()).toBe(false)

    // 节点名称仍可直接编辑
    const titleInput = wrapper.find('.rc-field input.rc-input')
    await titleInput.setValue('翻译节点改名')
    expect(flow.configs['translate-1'].title).toBe('翻译节点改名')
    wrapper.unmount()
  })
})
