// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteSourceSwitcher from './SiteSourceSwitcher.vue'
import { siteApi, sourceApi, type Source } from '../../api'

const source: Source = {
  sourceId: 'source-a', siteId: 'site-a', name: '原子源', url: 'https://example.com',
  configId: '', mainTable: '', owner: 'admin', state: 'C',
}
const templateSource: Source = {
  sourceId: 'source-template', siteId: 'site-template', name: '跨网站模板子源', url: 'https://template.example.com',
  configId: '', mainTable: '', owner: 'admin', state: 'C',
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
}

async function createWrapper() {
  mockApis()
  const wrapper = mount(SiteSourceSwitcher, { props: { siteId: 'site-a', activeKey: source.sourceId } })
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
})
