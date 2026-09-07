// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import NewSiteWizard from './NewSiteWizard.vue'
import { siteApi } from '@/api'

describe('NewSiteWizard', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  async function mountWizard() {
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

  // 0904 I15（Z8）：后端 url 必填、空了报错。**前端不加必填**，空的时候补占位值——
  // 「你不要搞必填，就是相当于你可以让他生成一个」。后端去掉必填后连同 helper 一起删。
  it('不填 URL 也能建成功，提交的是一眼认得出的占位值', async () => {
    const siteCreate = vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '11825', sourceId: '9001' })
    const { wrapper } = await mountWizard()
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()

    expect(siteCreate).toHaveBeenCalledTimes(1)
    const sources = siteCreate.mock.calls[0][1] as { url: string }[]
    expect(sources[0].url).toContain('placeholder.invalid')
  })

  it('填了 URL 就原样提交，不被占位值顶掉', async () => {
    const siteCreate = vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '11825', sourceId: '9001' })
    const { wrapper } = await mountWizard()
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    const rowInputs = wrapper.findAll('.rc-gate-row input.rc-input')
    await rowInputs[1].setValue('https://real.test/list')
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()

    const sources = siteCreate.mock.calls[0][1] as { url: string }[]
    expect(sources[0].url).toBe('https://real.test/list')
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
