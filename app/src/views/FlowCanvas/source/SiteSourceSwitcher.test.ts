// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteSourceSwitcher from './SiteSourceSwitcher.vue'
import ParamEditorDrawer from '@/components/param/ParamEditorDrawer.vue'
import { siteApi, sourceApi, paramApi, type Source, type Param } from '@/api'

const source: Source = {
  sourceId: 'source-a', siteId: 'site-a', name: '原子源', url: 'https://example.com',
  configId: '', mainTable: '', owner: 'admin', state: 'C',
}
const templateSource: Source = {
  sourceId: 'source-template', siteId: 'site-template', name: '跨网站模板子源', url: 'https://template.example.com',
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
  vi.spyOn(siteApi, 'siteSources').mockImplementation(async (siteId) => siteId === 'site-template' ? [templateSource] : [source])
  vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: 1, list: [templateSource] })
  vi.spyOn(siteApi, 'sourceAdd').mockResolvedValue({ ok: true, sourceId: 'source-new' })
  vi.spyOn(siteApi, 'cloneSource').mockResolvedValue({
    source: { ...source, sourceId: 'source-new', name: '复制子源' }, flowId: 'flow-new', tableIdMap: {},
  })
  vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
  vi.spyOn(sourceApi, 'sendSnatch').mockResolvedValue({ ok: true })
  vi.spyOn(paramApi, 'paramPaged').mockResolvedValue({ total: 2, list: [param913, param912] })
  vi.spyOn(paramApi, 'paramDetail').mockImplementation(async (id) => ({ 913: param913, 912: param912 }[id] ?? null))
  vi.spyOn(paramApi, 'genValues').mockImplementation(async (id) => paramSample[id] ?? [])
}

async function createWrapper() {
  mockApis()
  const wrapper = mount(SiteSourceSwitcher, {
    props: { siteId: 'site-a', activeKey: source.sourceId },
    global: { stubs: { 'el-drawer': { template: '<div><slot /><slot name="footer" /></div>' } } },
  })
  await flushPromises()
  return wrapper
}

afterEach(() => vi.restoreAllMocks())

describe('SiteSourceSwitcher', () => {
  it('默认复制本网站第一个子源', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加子源"]').trigger('click')
    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('默认复制子源')
    await inputs[1].setValue('https://default.example.com')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')

    expect(siteApi.cloneSource).toHaveBeenCalledWith(expect.objectContaining({ templateSourceId: source.sourceId }))
  })

  it('可搜索并选择全部子源作为模板，复制范围为子源', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加子源"]').trigger('click')
    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('复制子源')
    await inputs[1].setValue('https://copied.example.com')
    await wrapper.get('[data-testid="source-template-mode"]').setValue('search')
    await wrapper.get('[data-testid="source-template-search"]').setValue('跨网站')
    await flushPromises()
    await wrapper.get('[data-testid="source-template-option"]').trigger('click')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')

    expect(siteApi.cloneSource).toHaveBeenCalledWith({
      templateSourceId: templateSource.sourceId,
      targetSiteId: 'site-a',
      target: { name: '复制子源', url: 'https://copied.example.com' },
    })
    expect(siteApi.sourceAdd).not.toHaveBeenCalled()
  })

  it('选择空白模板时明确传 inherit=false', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加子源"]').trigger('click')
    const inputs = wrapper.findAll('.ssw-add-input')
    await inputs[0].setValue('空白子源')
    await inputs[1].setValue('https://blank.example.com')
    await wrapper.get('[data-testid="source-template-mode"]').setValue('blank')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')

    expect(siteApi.sourceAdd).toHaveBeenCalledWith(
      'site-a', expect.objectContaining({ name: '空白子源', url: 'https://blank.example.com' }), false,
    )
  })

  it('未填写子源名称时给出明确提示且不提交', async () => {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加子源"]').trigger('click')
    await wrapper.get('[data-testid="add-source-submit"]').trigger('click')

    expect(siteApi.cloneSource).not.toHaveBeenCalled()
    expect(siteApi.sourceAdd).not.toHaveBeenCalled()
  })

  it('双击子源行内重命名并保存', async () => {
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
    expect(sourceApi.sendSnatch).toHaveBeenCalledWith([source.sourceId])
  })

  it('子源行只负责进入详情，发起抓取收进右键菜单', async () => {
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

  it('支持折叠源列表，并在线下方面板完整展示选中源的名称与源 ID', async () => {
    const wrapper = await createWrapper()
    expect(wrapper.find('[data-testid="active-source-detail"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="active-source-full-name"]').text()).toBe(source.name)
    expect(wrapper.get('[data-testid="active-source-full-id"]').text()).toBe(source.sourceId)

    // 点击折叠分割栏图标收起列表
    await wrapper.get('.ssw-section-toggle').trigger('click')
    expect(wrapper.find('.ssw-search').exists()).toBe(false)
  })
})

describe('SiteSourceSwitcher · 参数源（0721 会议：加源支持普通子源 / 参数源）', () => {
  async function openParamPanel() {
    const wrapper = await createWrapper()
    await wrapper.get('[title="添加子源"]').trigger('click')
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

  it('切换到参数源：普通子源字段隐藏，参数源字段出现', async () => {
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
