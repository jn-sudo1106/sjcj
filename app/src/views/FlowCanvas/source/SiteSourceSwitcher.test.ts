// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ElMessage, ElMessageBox } from 'element-plus'
import SiteSourceSwitcher from './SiteSourceSwitcher.vue'
import ParamEditorDrawer from '@/components/param/ParamEditorDrawer.vue'
import { flowCenterApi, siteApi, sourceApi, paramApi, type Source, type Param } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useWorkspaceStore } from '@/stores/workspace'

const source: Source = {
  sourceId: 'source-a', siteId: 'site-a', name: '原源', url: 'https://example.com',
  configId: '', mainTable: '', owner: 'admin', state: 'C',
}
const templateSource: Source = {
  sourceId: 'source-template', siteId: 'site-template', name: '跨网站模板源', url: 'https://template.example.com',
  configId: '', mainTable: '', owner: 'admin', state: 'C',
}
// 0721 会议·参数源演示参数（页码=sequence 真实取值数 100，栏目=list 真实取值数 26），与 mock/params.ts 的 913/912 种子同口径
const param913: Param = { paramId: '913', name: '页码', kind: 'sequence', seq: { start: 1, end: 100, step: 1 }, usedBy: 0, owner: 'dev_zhonghe', updatedAt: '2026-07-21' }
const param912: Param = {
  paramId: '912', name: '栏目', kind: 'list',
  values: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'],
  usedBy: 0, owner: 'dev_zhonghe', updatedAt: '2026-07-21',
}
const paramSample: Record<string, string[]> = {
  913: Array.from({ length: 20 }, (_, i) => String(i + 1)), // genValues 预览截断 20 条，真实取值数仍是 100（见 paramValueCount）
  912: param912.values!,
}

function mockApis() {
  vi.spyOn(siteApi, 'siteDetail').mockResolvedValue({
    siteId: 'site-a', name: '网站 A', category: '', owner: 'admin', sourceCount: 1, errorCount: 0,
  })
  vi.spyOn(siteApi, 'siteSources').mockImplementation(async (siteId) => siteId === 'site-template' ? [{ ...templateSource }] : [{ ...source }])
  vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([{ ...source }])
  vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [templateSource] })
  vi.spyOn(siteApi, 'sourceAdd').mockResolvedValue({ ok: true, sourceId: 'source-new' })
  vi.spyOn(sourceApi, 'copySourceAndLocate').mockResolvedValue({
    ok: true, sourceId: 'source-new', name: '复制源',
  })
  vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
  vi.spyOn(sourceApi, 'loadParams').mockResolvedValue({})
  vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true, message: 'ok' })
  vi.spyOn(sourceApi, 'changeSite').mockResolvedValue({ ok: true, message: '已关联' })
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...templateSource })
  vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true, message: '已关联' })
  vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 2, list: [param913, param912] })
  vi.spyOn(paramApi, 'paramDetail').mockImplementation(async (id) => ({ 913: param913, 912: param912 }[id] ?? null))
  vi.spyOn(paramApi, 'genValues').mockImplementation(async (id) => paramSample[id] ?? [])
}

async function createWrapper() {
  sessionStorage.clear()
  setActivePinia(createPinia())
  mockApis()
  const wrapper = mount(SiteSourceSwitcher, {
    props: { siteId: 'site-a', activeKey: source.sourceId },
    global: {
      stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } },
      directives: { loading: {} },
    },
  })
  await flushPromises()
  return wrapper
}

afterEach(() => vi.restoreAllMocks())

describe('SiteSourceSwitcher', () => {
  it('默认复制本网站第一个源', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加源"]').trigger('click')
    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('默认复制源')
    await inputs[1].setValue('https://default.example.com')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')
    await flushPromises()

    expect(sourceApi.copySourceAndLocate).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: source.sourceId,
      name: '默认复制源',
      url: 'https://default.example.com',
      flag: 1,
    }))
    expect(sourceApi.changeSite).toHaveBeenCalledWith(['source-new'], 'site-a')
  })

  it('可搜索并选择全部源作为模板，复制范围为源', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加源"]').trigger('click')
    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('复制源')
    await inputs[1].setValue('https://copied.example.com')
    await wrapper.get('[data-testid="source-template-mode"]').setValue('search')
    await wrapper.get('[data-testid="source-template-search"]').setValue('跨网站')
    await flushPromises()
    await wrapper.get('[data-testid="source-template-option"]').trigger('click')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')
    await flushPromises()

    expect(sourceApi.copySourceAndLocate).toHaveBeenCalledWith({
      sourceId: templateSource.sourceId,
      name: '复制源',
      url: 'https://copied.example.com',
      flag: 1,
    })
    expect(sourceApi.changeSite).toHaveBeenCalledWith(['source-new'], 'site-a')
    expect(siteApi.sourceAdd).not.toHaveBeenCalled()
  })

  it('选择空白模板时明确传 inherit=false', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加源"]').trigger('click')
    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('空白源')
    await inputs[1].setValue('https://blank.example.com')
    await wrapper.get('[data-testid="source-template-mode"]').setValue('blank')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')
    await flushPromises()

    expect(siteApi.sourceAdd).toHaveBeenCalledWith(
      'site-a', expect.objectContaining({ name: '空白源', url: 'https://blank.example.com' }), false,
    )
    expect(sourceApi.copySourceAndLocate).not.toHaveBeenCalled()
  })

  it('按模板复制失败时不换网站', async () => {
    const wrapper = await createWrapper()
    vi.mocked(sourceApi.copySourceAndLocate).mockResolvedValueOnce({ ok: false, message: '复制后无法唯一定位新源' })
    await wrapper.get('[title="添加源"]').trigger('click')
    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('复制源')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')
    await flushPromises()

    expect(sourceApi.changeSite).not.toHaveBeenCalled()
  })

  // 0812 计划 M1-11：绑定已有源/仅展示未关联入口已删除，只保留新建源；
  // 按源 ID 导入现有源的能力放到 M4 的"导入源"，接旧平台真实批量归属契约。
  it('添加源弹窗不再提供绑定已有源入口', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加源"]').trigger('click')

    expect(wrapper.find('[data-testid="source-add-mode"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="add-mode-bind"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="bind-source-table"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('绑定已有源')
    expect(wrapper.text()).not.toContain('仅展示未关联')
  })

  it('未填写源名称时给出明确提示且不提交', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加源"]').trigger('click')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')

    expect(sourceApi.copySourceAndLocate).not.toHaveBeenCalled()
    expect(sourceApi.changeSite).not.toHaveBeenCalled()
    expect(siteApi.sourceAdd).not.toHaveBeenCalled()
  })

  it('双击源行内重命名并保存', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('.ssw-row-main').trigger('dblclick')
    const input = wrapper.get('[data-testid="source-rename-input"]')
    await input.setValue('重命名后')
    await input.trigger('keydown.enter')

    expect(sourceApi.sourceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: source.sourceId, name: '重命名后',
    }))
    expect(wrapper.emitted('added')?.[0]).toEqual([expect.objectContaining({ name: '重命名后' })])
  })

  it('右键菜单提供重命名与发起抓取，且可发起抓取', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('.ssw-row-main').trigger('contextmenu', { clientX: 10, clientY: 10 })

    expect(wrapper.text()).toContain('重命名')
    expect(wrapper.text()).toContain('发起抓取')
    await wrapper.get('[data-testid="source-menu-launch"]').trigger('click')
    await flushPromises()
    expect(sourceApi.sendSnatchWithParam).toHaveBeenCalledWith(expect.objectContaining({ ids: [source.sourceId] }))
  })

  it('源行只负责进入详情，发起抓取收进右键菜单', async () => {
    const wrapper = await createWrapper()

    await wrapper.get('.ssw-row-main').trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[source]])
    expect(wrapper.find('.ssw-row-run').exists()).toBe(false)
  })

  it('点击列表开头的全部行触发 pickSite 事件（取消源 ID 过滤）', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('.ssw-row-all-btn').trigger('click')
    expect(wrapper.emitted('pickSite')).toBeTruthy()
  })

  it('支持折叠源列表，并在线下方面板完整展示选中源的名称、源 ID 与源 URL', async () => {
    const wrapper = await createWrapper()
    expect(wrapper.find('[data-testid="active-source-detail"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="active-source-full-name"]').text()).toBe(source.name)
    expect(wrapper.get('[data-testid="active-source-full-id"]').text()).toBe(source.sourceId)
    expect(wrapper.get('[data-testid="active-source-url"]').text()).toBe(source.url)
    expect(wrapper.text()).toContain('源 URL')

    // 点击折叠分割栏图标收起列表
    await wrapper.get('.ssw-section-toggle').trigger('click')
    expect(wrapper.find('.ssw-search').exists()).toBe(false)
  })

  it('源 URL 可复制，空地址时复制按钮禁用', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = await createWrapper()
    await wrapper.get('[data-testid="copy-source-url"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith(source.url)

    mockApis()
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue([{ ...source, url: '' }])
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue([{ ...source, url: '' }])
    sessionStorage.clear()
    setActivePinia(createPinia())
    const empty = mount(SiteSourceSwitcher, {
      props: { siteId: 'site-a', activeKey: source.sourceId },
      global: {
        stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } },
        directives: { loading: {} },
      },
    })
    await flushPromises()
    expect(empty.get('[data-testid="active-source-url"]').text()).toBe('—')
    expect((empty.get('[data-testid="copy-source-url"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('编辑源：改名称和 URL 后落库，同步侧栏与画布头，不切源', async () => {
    const wrapper = await createWrapper()
    const flow = useFlowStore()
    const ws = useWorkspaceStore()
    flow.sourceCtx = { ...source }
    flow.sourceCfg = { ...source }
    ws.open(source.sourceId, source.name)

    await wrapper.get('[data-testid="edit-source"]').trigger('click')
    expect(wrapper.find('[data-testid="edit-source-dialog"]').exists()).toBe(true)
    await wrapper.get('[data-testid="edit-source-name"]').setValue('改名后')
    await wrapper.get('[data-testid="edit-source-url"]').setValue('https://new.example.com/list')
    await wrapper.get('[data-testid="edit-source-save"]').trigger('click')
    await flushPromises()

    expect(sourceApi.sourceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: source.sourceId, name: '改名后', url: 'https://new.example.com/list',
    }))
    expect(wrapper.get('[data-testid="active-source-full-name"]').text()).toBe('改名后')
    expect(wrapper.get('[data-testid="active-source-url"]').text()).toBe('https://new.example.com/list')
    expect(flow.sourceCtx?.name).toBe('改名后')
    expect(flow.sourceCtx?.url).toBe('https://new.example.com/list')
    expect(ws.tabs.find((t) => t.sourceId === source.sourceId)?.name).toBe('改名后')
    expect(wrapper.emitted('added')).toBeUndefined()
  })
})

describe('SiteSourceSwitcher · 参数源（0721 会议：加源支持普通源 / 参数源）', () => {
  async function openParamPanel() {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加源"]').trigger('click')
    await wrapper.get('[data-testid="source-kind-param"]').trigger('click')
    return wrapper
  }
  async function pickCandidate(wrapper: Awaited<ReturnType<typeof createWrapper>>, paramId: string) {
    // 选好一个候选参数后弹层保持打开（支持连续多选，同原型行为）——只在尚未打开时才点开关按钮，
    // 否则第二次调用会把已经打开的弹层重新关掉。
    if (!wrapper.find('.ssw-picker-pop').exists()) {
      await wrapper.get('[data-testid="param-source-pick"]').trigger('click')
      await flushPromises()
    }
    const items = wrapper.findAll('.ssw-picker-item')
    const target = items.find((item) => item.text().includes(`$PARAM$_${paramId}`))
    if (!target) throw new Error(`候选参数 ${paramId} 未找到`)
    await target.trigger('click')
    await flushPromises()
  }

  it('切换到参数源：普通源字段隐藏，参数源字段出现', async () => {
    const wrapper = await openParamPanel()
    expect(wrapper.find('[data-testid="source-template-mode"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="param-source-template"]').exists()).toBe(true)
  })

  it('选择已有参数后加入参数列表，模板自动生成占位符；删除后模板同步更新', async () => {
    const wrapper = await openParamPanel()
    await pickCandidate(wrapper, '913')
    expect(wrapper.get('.ssw-param-table').text()).toContain('$PARAM$_913')
    const template = wrapper.get<HTMLInputElement>('[data-testid="param-source-template"]')
    expect(template.element.value).toContain('$PARAM$_913')

    await wrapper.get('.ssw-text-btn.danger').trigger('click')
    expect(wrapper.get('.ssw-param-table').text()).not.toContain('$PARAM$_913')
    expect(template.element.value).not.toContain('$PARAM$_913')
  })

  it('编组：两个参数划入同一组后拼接类型显示为「顺序」，值数不一致时红色警告', async () => {
    const wrapper = await openParamPanel()
    await pickCandidate(wrapper, '913') // 页码：sequence 1~100，真实取值数 100
    await pickCandidate(wrapper, '912') // 栏目：list a~z，真实取值数 26
    const selects = wrapper.findAll('.ssw-group-select')
    await selects[0].setValue('__new')
    await flushPromises()
    await selects[1].setValue('A')
    await flushPromises()

    expect(wrapper.text()).toContain('顺序')
    expect(wrapper.find('.ssw-preview-warning').exists()).toBe(true)
    expect(wrapper.text()).toContain('值数需一致')
  })

  it('手动编辑模板后不再被自动重生成覆盖；点击「重新生成」恢复自动模板', async () => {
    const wrapper = await openParamPanel()
    await pickCandidate(wrapper, '913')
    const template = wrapper.get<HTMLInputElement>('[data-testid="param-source-template"]')
    await template.setValue('http://custom/$PARAM$_913')
    await pickCandidate(wrapper, '912')
    expect(template.element.value).toBe('http://custom/$PARAM$_913')

    await wrapper.get('.ssw-sec-label .link').trigger('click')
    expect(template.element.value).toContain('$PARAM$_913')
    expect(template.element.value).toContain('$PARAM$_912')
  })

  it('未选组（无组/不同组）时拼接类型为笛卡尔积，计数按各参数取值数相乘', async () => {
    const wrapper = await openParamPanel()
    await pickCandidate(wrapper, '913')
    await pickCandidate(wrapper, '912')

    expect(wrapper.text()).toContain('笛卡尔积')
    expect(wrapper.text()).toContain('2,600') // 100 × 26
  })

  it('提交参数源：校验名称/基础url/参数非空，成功后 sourceAdd 携带 kind/baseUrl/urlTemplate/paramRefs', async () => {
    const wrapper = await openParamPanel()
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')
    expect(siteApi.sourceAdd).not.toHaveBeenCalled()

    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('参数源测试')
    await inputs[1].setValue('http://FundComment-2017052400023003000000000013026')
    await pickCandidate(wrapper, '913')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')
    await flushPromises()

    expect(siteApi.sourceAdd).toHaveBeenCalledWith(
      'site-a',
      expect.objectContaining({
        name: '参数源测试',
        kind: 'param',
        baseUrl: 'http://FundComment-2017052400023003000000000013026',
        urlTemplate: expect.stringContaining('$PARAM$_913'),
        paramRefs: [{ paramId: '913', group: null }],
      }),
      false,
    )
  })

  it('同组值数不一致时阻断提交', async () => {
    const wrapper = await openParamPanel()
    await pickCandidate(wrapper, '913') // sequence 1~100，真实取值数 100
    await pickCandidate(wrapper, '912') // list a~z，真实取值数 26
    const selects = wrapper.findAll('.ssw-group-select')
    await selects[0].setValue('__new') // 913 进新建组 A
    await flushPromises()
    await selects[1].setValue('A') // 912 进 A 组
    await flushPromises()

    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('不一致测试')
    await inputs[1].setValue('http://test.example')

    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')
    await flushPromises()

    expect(siteApi.sourceAdd).not.toHaveBeenCalled()
  })

  it('新建参数（弹中弹复用 ParamEditorDrawer）：保存成功后自动入列，占位符出现在模板', async () => {
    const wrapper = await openParamPanel()
    await wrapper.get('[data-testid="param-source-new"]').trigger('click')
    const drawer = wrapper.getComponent(ParamEditorDrawer)
    const created: Param = { paramId: 'param-9001', name: '新建的参数', kind: 'list', values: ['x', 'y'], usedBy: 0 }
    drawer.vm.$emit('saved', created)
    await flushPromises()

    expect(wrapper.get('.ssw-param-table').text()).toContain('$PARAM$_param-9001')
    expect(wrapper.get('.ssw-param-table').text()).toContain('新建的参数')
    const template = wrapper.get<HTMLInputElement>('[data-testid="param-source-template"]')
    expect(template.element.value).toContain('$PARAM$_param-9001')
  })
})

// 批量导入弹窗（0812 会议反馈：新增源和导入已有源合并成一个入口，弹窗里用 tab 分，不再是两个按钮）
describe('SiteSourceSwitcher · 批量导入（新增源 tab）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('默认打开就是"新增源" tab，按原有 名称;URL 格式提交', async () => {
    const wrapper = await createWrapper()
    const importSources = vi.spyOn(siteApi, 'siteImportSources').mockResolvedValue({ ok: true, message: '已导入 1 个源' })

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    expect(wrapper.find('[data-testid="bind-source-table"]').exists()).toBe(false)
    await wrapper.get('.ssw-import-textarea').setValue('测试源;https://example.com')
    await wrapper.get('[data-testid="batch-import-submit"]').trigger('click')

    expect(importSources).toHaveBeenCalledWith('site-a', '测试源;https://example.com')
  })

  it('点"导入已有源" tab 切换过去，再点回"新增源"，两边状态不互相污染', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="bind-source-table"]').exists()).toBe(true)

    await wrapper.get('[data-testid="batch-tab-new"]').trigger('click')
    expect(wrapper.find('[data-testid="bind-source-table"]').exists()).toBe(false)
    expect(wrapper.find('.ssw-import-textarea').exists()).toBe(true)
  })
})

// 导入已有源（0812 计划 M4-5，1:1 迁移旧平台 SiteList.vue 的关联源弹窗）：跟"新增源" tab
// 是两回事——那边建的是新源，这里导入的是已经存在、可能属于别的网站甚至没有归属的源。
describe('SiteSourceSwitcher · 导入已有源（M4-5）', () => {
  afterEach(() => vi.restoreAllMocks())

  const unbound: Source = { sourceId: 'src-unbound', name: '未关联源', url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
  const otherSite: Source = { sourceId: 'src-other', siteId: 'site-b', siteName: '别的网站', name: '别站的源', url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }
  const sameSite: Source = { sourceId: 'src-same', siteId: 'site-a', name: '已在本站的源', url: '', configId: '', mainTable: '', owner: 'admin', state: 'C' }

  it('打开弹窗加载候选源，按归属状态显示"未关联/已属本站/已属其他网站"', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 3, list: [unbound, otherSite, sameSite] })

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()
    // 默认勾选"仅展示未关联"，先关掉才能看到三种状态都在;取消勾选会触发重新查询（服务端过滤）
    await wrapper.get('.ssw-bind-hide input[type="checkbox"]').setValue(false)
    await flushPromises()

    const table = wrapper.get('[data-testid="bind-source-table"]')
    expect(table.text()).toContain('未关联')
    expect(table.text()).toContain('已属本站')
    expect(table.text()).toContain('已属其他网站')
    expect(table.text()).toContain('别的网站')
  })

  it('勾选源后点击"确认导入"，调用 changeSite(选中的源ID, 当前网站ID) 并刷新列表', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [unbound] })

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="bind-source-table"] input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-testid="bind-source-submit"]').trigger('click')
    await flushPromises()

    expect(sourceApi.changeSite).toHaveBeenCalledWith(['src-unbound'], 'site-a')
    expect(wrapper.find('[data-testid="bind-source-table"]').exists()).toBe(false) // 弹窗已关闭
  })

  it('勾选的源里有已属其他网站的，提交前弹二次确认；确认后才真的调用 changeSite（M4-6：显著标记 + 二次确认，不硬拦）', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [otherSite] })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()
    await wrapper.get('.ssw-bind-hide input[type="checkbox"]').setValue(false) // 关掉"仅展示未关联"才能看到别站的源
    await wrapper.get('[data-testid="bind-source-table"] input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-testid="bind-source-submit"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('别的网站'), '确认导入', expect.anything())
    expect(sourceApi.changeSite).toHaveBeenCalledWith(['src-other'], 'site-a')
  })

  it('二次确认弹窗点取消时，不调用 changeSite', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [otherSite] })
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()
    await wrapper.get('.ssw-bind-hide input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-testid="bind-source-table"] input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-testid="bind-source-submit"]').trigger('click')
    await flushPromises()

    expect(sourceApi.changeSite).not.toHaveBeenCalled()
  })

  it('未勾选任何源时，"确认导入"按钮禁用', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [unbound] })

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()

    const btn = wrapper.get<HTMLButtonElement>('[data-testid="bind-source-submit"]')
    expect(btn.element.disabled).toBe(true)
  })

  // 按源ID批量导入（0812 会议反馈）：不是"检索出来再手动勾选"，是粘贴一批源 ID 直接提交——
  // ID 本身就是选择，跳过表格预览/勾选这一步。
  it('按源ID批量导入：粘贴源 ID 直接提交，无需先在表格里勾选', async () => {
    const wrapper = await createWrapper()
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="id-import-toggle"]').trigger('click')
    paged.mockResolvedValueOnce({ total: 1, list: [unbound] })
    await wrapper.get('[data-testid="id-import-textarea"]').setValue('src-unbound')
    await wrapper.get('[data-testid="id-import-submit"]').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: ['src-unbound'] }))
    expect(sourceApi.changeSite).toHaveBeenCalledWith(['src-unbound'], 'site-a', expect.any(Function))
    expect(wrapper.find('[data-testid="bind-source-table"]').exists()).toBe(false) // 弹窗已关闭
  })

  it('按源ID批量导入：未找到的 ID 会提示，找到的部分照常导入', async () => {
    const wrapper = await createWrapper()
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="id-import-toggle"]').trigger('click')
    paged.mockResolvedValueOnce({ total: 1, list: [unbound] })
    await wrapper.get('[data-testid="id-import-textarea"]').setValue('src-unbound, ghost-id-not-real')
    await wrapper.get('[data-testid="id-import-submit"]').trigger('click')
    await flushPromises()

    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: ['src-unbound', 'ghost-id-not-real'] }))
    expect(sourceApi.changeSite).toHaveBeenCalledWith(['src-unbound'], 'site-a', expect.any(Function))
  })

  it('按源ID批量导入：命中的源已属其他网站时，同样先弹二次确认再提交', async () => {
    const wrapper = await createWrapper()
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 0, list: [] })
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="id-import-toggle"]').trigger('click')
    paged.mockResolvedValueOnce({ total: 1, list: [otherSite] })
    await wrapper.get('[data-testid="id-import-textarea"]').setValue('src-other')
    await wrapper.get('[data-testid="id-import-submit"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('别的网站'), '确认导入', expect.anything())
    expect(sourceApi.changeSite).toHaveBeenCalledWith(['src-other'], 'site-a', expect.any(Function))
  })

  it('勾选"仅展示未关联"走服务端 siteIds=-1 过滤，翻页/总数按过滤后口径（不再前端过滤当前页）', async () => {
    const wrapper = await createWrapper()
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockImplementation(async (p) =>
      p?.siteIds === '-1' ? { total: 1, list: [unbound] } : { total: 3, list: [unbound, otherSite, sameSite] },
    )

    await wrapper.get('[data-testid="open-batch"]').trigger('click')
    await wrapper.get('[data-testid="batch-tab-existing"]').trigger('click')
    await flushPromises()

    // 默认就是"仅展示未关联"勾选态：请求必须带 siteIds='-1'，表格只显示未关联源
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ siteIds: '-1' }))
    let table = wrapper.get('[data-testid="bind-source-table"]')
    expect(table.text()).toContain('未关联源')
    expect(table.text()).not.toContain('别站的源')
    expect(table.text()).not.toContain('已在本站的源')

    // 取消勾选：重新查询且不带 siteIds，三种归属都能看到
    await wrapper.get('.ssw-bind-hide input[type="checkbox"]').setValue(false)
    await flushPromises()
    const lastCall = paged.mock.calls[paged.mock.calls.length - 1][0]
    expect(lastCall?.siteIds).toBeUndefined()
    table = wrapper.get('[data-testid="bind-source-table"]')
    expect(table.text()).toContain('别站的源')
    expect(table.text()).toContain('已在本站的源')
  })
})

// 0903 Y8-A：复制源之后补第三步——把新源关联到**被复制源所属的流程**。
// 前两步（copySource?flag=1 + changeSite）复制的是源与配置，不会把新源挂到流程上；
// 而 0903 H01 之后配置挂在流程上、执行按 FLOW_ID 反查，不补这步新源就是没有流程的孤儿。
describe('SiteSourceSwitcher · 复制源后关联到流程（Y8-A）', () => {
  async function copyWithTemplate(wrapper: Awaited<ReturnType<typeof createWrapper>>) {
    await wrapper.get('[title="添加源"]').trigger('click')
    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('复制源')
    await inputs[1].setValue('https://copied.example.com')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')
    await flushPromises()
  }

  it('复制成功后调 bindSources，flowId 取自被复制源', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...source, flowId: 'flow-777' })
    await copyWithTemplate(wrapper)
    expect(flowCenterApi.bindSources).toHaveBeenCalledWith(['source-new'], 'flow-777')
  })

  it('列表上没带 flowId 时回查 sourceDetail，不据此判定"没有流程"', async () => {
    const wrapper = await createWrapper()
    const detail = vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...source, flowId: 'flow-888' })
    await copyWithTemplate(wrapper)
    expect(detail).toHaveBeenCalledWith(source.sourceId)
    expect(flowCenterApi.bindSources).toHaveBeenCalledWith(['source-new'], 'flow-888')
  })

  it('第三步失败不影响前两步的结果，只提示可去流程中心手动关联', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...source, flowId: 'flow-777' })
    vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: false, message: '流程不存在' })
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never)
    await copyWithTemplate(wrapper)

    // 前两步照常发生，没有回滚（源已经建出来了，回滚等于删源）
    expect(sourceApi.copySourceAndLocate).toHaveBeenCalled()
    expect(sourceApi.changeSite).toHaveBeenCalledWith(['source-new'], 'site-a')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('可在流程中心手动关联'))
  })

  it('被复制源本来就没有流程时不报错，只说明新源也未关联', async () => {
    const wrapper = await createWrapper()
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...source, flowId: undefined })
    const ok = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    await copyWithTemplate(wrapper)

    expect(flowCenterApi.bindSources).not.toHaveBeenCalled()
    expect(ok).toHaveBeenCalledWith(expect.stringContaining('未关联流程'))
  })
})

// 强刷与快速切站的竞态（2026-09-07 修复）：force 路径原来没有 loadSeq 防护——
// 网站编辑保存触发 load(true) 后立刻切到另一站，慢的强刷响应回来会把新站数据覆盖掉。
describe('SiteSourceSwitcher · 强刷竞态防护', () => {
  afterEach(() => vi.restoreAllMocks())

  it('强刷响应晚于切站时，旧站数据不覆盖新站', async () => {
    sessionStorage.clear()
    setActivePinia(createPinia())
    const detailOf = (name: string) => ({ siteId: 'site-x', name, category: '', owner: 'admin', sourceCount: 1, errorCount: 0 })
    // site-a 的响应被 gate 挂起（模拟慢），site-b 正常返回
    let releaseA: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { releaseA = resolve })
    vi.spyOn(siteApi, 'siteDetail').mockImplementation(async (siteId) => {
      if (siteId === 'site-a') { await gate; return detailOf('网站 A') }
      return detailOf('网站 B')
    })
    vi.spyOn(siteApi, 'siteSources').mockImplementation(async (siteId) => {
      if (siteId === 'site-a') { await gate; return [{ ...source }] }
      return [{ ...source, sourceId: 'source-b', siteId: 'site-b', name: 'B 站源' }]
    })
    vi.spyOn(siteApi, 'siteSourcePreview').mockImplementation(async (siteId) =>
      siteId === 'site-a' ? [{ ...source }] : [{ ...source, sourceId: 'source-b', siteId: 'site-b', name: 'B 站源' }])

    const wrapper = mount(SiteSourceSwitcher, {
      props: { siteId: 'site-a', activeKey: source.sourceId },
      global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } }, directives: { loading: {} } },
    })
    // 初始加载（非 force）用 preview——site-a 的 detail 仍被 gate 卡着，先放行完成首屏
    releaseA?.()
    await flushPromises()

    // 强刷 site-a：detail/sources 对 site-a 重新挂起（gate2）
    let release2: (() => void) | undefined
    const gate2 = new Promise<void>((resolve) => { release2 = resolve })
    const detailSpy = vi.spyOn(siteApi, 'siteDetail').mockImplementation(async (siteId) => {
      if (siteId === 'site-a') { await gate2; return detailOf('网站 A') }
      return detailOf('网站 B')
    })
    vi.spyOn(siteApi, 'siteSources').mockImplementation(async (siteId) => {
      if (siteId === 'site-a') { await gate2; return [{ ...source }] }
      return [{ ...source, sourceId: 'source-b', siteId: 'site-b', name: 'B 站源' }]
    })
    // 触发 force 加载（不 await，模拟用户点保存后立刻切站）
    void (wrapper.vm as unknown as { reload: () => Promise<void> }).reload()
    await wrapper.setProps({ siteId: 'site-b' })
    await flushPromises()

    // 此时显示的应该是 site-b 的数据
    expect(wrapper.text()).toContain('网站 B')
    expect(wrapper.text()).toContain('B 站源')

    // 强刷的旧站响应这时才回来
    release2?.()
    await flushPromises()

    // 关键断言：旧站（网站 A）的晚到响应不能覆盖新站（网站 B）
    expect(detailSpy).toHaveBeenCalled()
    expect(wrapper.text()).toContain('网站 B')
    expect(wrapper.text()).not.toContain('网站 A')
    wrapper.unmount()
  })
})

// 反查命中态（0909）：数据视图「按条件查源」把命中源写进 store，侧栏在此收窄。
// 会上原话「就是要再加到左边最好」「因为我点一个源又要进去」。
describe('SiteSourceSwitcher · 按条件查源的命中态', () => {
  const many = [
    { ...source, sourceId: 's1', name: '源一' },
    { ...source, sourceId: 's2', name: '源二' },
    { ...source, sourceId: 's3', name: '源三' },
  ]

  async function mountWithHits(hits: { sourceId: string; count: number }[], siteId = 'site-a') {
    sessionStorage.clear()
    setActivePinia(createPinia())
    mockApis()
    vi.spyOn(siteApi, 'siteSources').mockResolvedValue(many)
    vi.spyOn(siteApi, 'siteSourcePreview').mockResolvedValue(many)
    const ws = useWorkspaceStore()
    if (hits.length) ws.setBackTraceHits(siteId, hits)
    const wrapper = mount(SiteSourceSwitcher, {
      props: { siteId: 'site-a', activeKey: '' },
      global: {
        stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } },
        directives: { loading: {} },
      },
    })
    await flushPromises()
    return { wrapper, ws }
  }

  it('只显示命中的源，并按命中条数从多到少排——问题最严重的排最前', async () => {
    const { wrapper } = await mountWithHits([{ sourceId: 's3', count: 2 }, { sourceId: 's1', count: 40 }])

    const names = wrapper.findAll('.ssw-row-name').map((n) => n.text())
    expect(names).toEqual(['源一', '源三'])
    expect(wrapper.text()).not.toContain('源二')
  })

  it('每行带上该源命中几条', async () => {
    const { wrapper } = await mountWithHits([{ sourceId: 's1', count: 40 }, { sourceId: 's3', count: 2 }])
    expect(wrapper.findAll('[data-testid="sidebar-hit-count"]').map((n) => n.text())).toEqual(['40', '2'])
  })

  it('给一条明确的出口：显示命中个数 + ✕ 恢复全部源', async () => {
    const { wrapper, ws } = await mountWithHits([{ sourceId: 's1', count: 40 }])
    const bar = wrapper.get('[data-testid="sidebar-backtrace-bar"]')
    expect(bar.text()).toContain('条件命中 1 个源')

    await bar.get('button').trigger('click')
    await flushPromises()
    expect(ws.backTraceHitsOf('site-a')).toEqual([])
    // 恢复全部源，「全部（不根据源 ID 过滤）」那一行也随之回来——命中态下它是藏起来的
    expect(wrapper.findAll('.ssw-row-name').map((n) => n.text())).toEqual(['全部', '源一', '源二', '源三'])
  })

  it('命中态属于另一个网站时不生效，侧栏照常显示全部源', async () => {
    const { wrapper } = await mountWithHits([{ sourceId: 's1', count: 40 }], 'site-other')
    expect(wrapper.find('[data-testid="sidebar-backtrace-bar"]').exists()).toBe(false)
    expect(wrapper.findAll('.ssw-row-name').map((n) => n.text())).toEqual(['全部', '源一', '源二', '源三'])
  })

  it('没有命中态时一切照旧（不显示提示条、不显示条数、保留「全部」行）', async () => {
    const { wrapper } = await mountWithHits([])
    expect(wrapper.find('[data-testid="sidebar-backtrace-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sidebar-hit-count"]').exists()).toBe(false)
    expect(wrapper.findAll('.ssw-row-name').map((n) => n.text())).toEqual(['全部', '源一', '源二', '源三'])
  })
})
