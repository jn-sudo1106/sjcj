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
