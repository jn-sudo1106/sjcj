// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import NewSiteWizard from './NewSiteWizard.vue'
import { flowCenterApi, siteApi, type FlowRecord } from '@/api'

describe('NewSiteWizard', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  const TEMPLATE = { id: 'flow-1', name: '新闻标准模板', definition: { main: [], branches: [], configs: {} }, updatedAt: '', isTemplate: true } as unknown as FlowRecord

  async function mountWizard(templates: FlowRecord[] = []) {
    vi.spyOn(flowCenterApi, 'templates').mockResolvedValue(templates)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/canvas', component: { template: '<div />' } },
        { path: '/collect', component: { template: '<div />' } },
      ],
    })
    await router.push({ path: '/canvas', query: { mode: 'new' } })
    await router.isReady()
    const pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(NewSiteWizard, {
      global: {
        plugins: [pinia, router, ElementPlus],
        stubs: {
          CategoryTreePicker: {
            template: '<div class="cat-stub" />',
            mounted() {
              this.$emit('update:modelValue', { dirId: '7', category: '新闻', categoryPath: '/新闻' })
            },
          },
        },
      },
    })
    await flushPromises()
    return { wrapper, router }
  }

  it('单页同时展示网站信息和源清单，没有分步', async () => {
    const { wrapper } = await mountWizard()
    expect(wrapper.text()).toContain('新建采集 · 网站基础信息')
    expect(wrapper.text()).toContain('源清单')
    expect(wrapper.text()).toContain('创建并进入编排')
    expect(wrapper.text()).not.toContain('① 网站信息')
    expect(wrapper.text()).not.toContain('下一步')
  })

  it('网站名称和分类必填；首个源名称跟随网站名称', async () => {
    const { wrapper } = await mountWizard()
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('新建采集 · 网站基础信息')

    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    const inputs = wrapper.findAll('input.rc-input')
    expect((inputs[1].element as HTMLInputElement).value).toBe('向导测试站')
  })

  // 0903 Y8-C（H03）：这一页可以选流程模板。原注释「不在这一页选择流程、模板」已随之改掉。
  it('默认只列已标记为模板的流程，且默认「不使用（空白画布）」', async () => {
    const { wrapper } = await mountWizard([TEMPLATE])
    const select = wrapper.get('[data-testid="new-site-template"]')
    expect((select.element as HTMLSelectElement).value).toBe('')
    expect(select.text()).toContain('不使用（空白画布）')
    expect(select.text()).toContain('新闻标准模板')
    expect(flowCenterApi.templates).toHaveBeenCalled()
  })

  it('切到「查看全部流程」时改查 paged，不再只列模板', async () => {
    const { wrapper } = await mountWizard([TEMPLATE])
    const paged = vi.spyOn(flowCenterApi, 'paged').mockResolvedValue({ total: 0, list: [] })
    await wrapper.get('[data-testid="new-site-template-scope"]').setValue('all')
    await flushPromises()
    expect(paged).toHaveBeenCalled()
  })

  it('选了模板：建站后走 copyFlow 复制出一套配置，再把新源整批关联上去', async () => {
    vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '11825', sourceId: '9001' })
    const copy = vi.spyOn(flowCenterApi, 'copy').mockResolvedValue('flow-new')
    const bind = vi.spyOn(flowCenterApi, 'bindSources').mockResolvedValue({ ok: true })
    const { wrapper } = await mountWizard([TEMPLATE])
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    await wrapper.get('[data-testid="new-site-template"]').setValue('flow-1')
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()

    // H03：是把模板的配置**复制出一套**，不是引用模板，所以走 copyFlow 而不是 saveFlow
    expect(copy).toHaveBeenCalledWith('flow-1', expect.stringContaining('向导测试站'))
    // N 个源共用这一条新流程（0903 H01 的口径）
    expect(bind).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]), 'flow-new')
  })

  it('没选模板时不发任何流程请求', async () => {
    vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '11825', sourceId: '9001' })
    const copy = vi.spyOn(flowCenterApi, 'copy')
    const { wrapper } = await mountWizard([TEMPLATE])
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()
    expect(copy).not.toHaveBeenCalled()
  })

  it('套模板失败不阻断建站：网站已建好，只提示可进画布手工配', async () => {
    vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '11825', sourceId: '9001' })
    vi.spyOn(flowCenterApi, 'copy').mockRejectedValue(new Error('模板不存在'))
    const { wrapper, router } = await mountWizard([TEMPLATE])
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    await wrapper.get('[data-testid="new-site-template"]').setValue('flow-1')
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()
    // 照样进画布，没有因为模板失败把建站结果吞掉
    expect(router.currentRoute.value.query.siteId).toBe('11825')
  })

  it('提交只创建网站和首批源，然后进入首个源画布', async () => {
    const siteCreate = vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({
      ok: true, siteId: '11825', sourceId: '9001',
    })
    const { wrapper, router } = await mountWizard()
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()
    expect(siteCreate).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.query.siteId).toBe('11825')
    expect(router.currentRoute.value.query.sourceId).toBe('9001')
  })
})
