// @vitest-environment jsdom
vi.mock('@/utils/flow/createFromTemplate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/flow/createFromTemplate')>()),
  pickFlowTemplate: vi.fn(async () => 'template-1'),
  createFlowFromTemplate: vi.fn(async (_id: string, name: string) => { const { flowCenterApi } = await import('@/api'); return flowCenterApi.save({ name, definition: { main: ['start', 'end'], branches: [], configs: {} }, fromTemplateId: 'template-1' }) }),
}))
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import NewSiteWizard from './NewSiteWizard.vue'
import { flowCenterApi, siteApi, workflowBindingApi } from '@/api'

const addSourcesToBizDir = vi.fn(async () => 1)
vi.mock('@/api/sourceDirs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/sourceDirs')>()),
  addSourcesToBizDir: (...args: unknown[]) => addSourcesToBizDir(...(args as [])),
}))

describe('NewSiteWizard', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
    addSourcesToBizDir.mockClear()
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

  // 2026-10-12：217 后端按源读步骤要求源已绑流程；用户定同一次新建的源共用一条流程（名称 = 网站名）
  it('建完网站和源后新建一条同名流程，本批源全部绑上并设为默认', async () => {
    vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '11825', sourceId: '9001', sourceIds: ['9001', '9002'] })
    const save = vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ id: '14011270', name: '向导测试站', definition: {} as never, updatedAt: '' })
    const bind = vi.spyOn(workflowBindingApi, 'bind').mockResolvedValue(undefined as never)
    const { wrapper, router } = await mountWizard()
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].name).toBe('向导测试站')
    expect(bind.mock.calls.map((c) => c[0])).toEqual([
      { sourceId: '9001', workflowId: '14011270', primary: true },
      { sourceId: '9002', workflowId: '14011270', primary: true },
    ])
    expect(router.currentRoute.value.query.sourceId).toBe('9001')
  })

  it('新建流程失败不挡进入画布（网站和源已落库），只提示可在画布补建', async () => {
    vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '11825', sourceId: '9001', sourceIds: ['9001'] })
    vi.spyOn(flowCenterApi, 'save').mockRejectedValue(new Error('服务器异常'))
    const bind = vi.spyOn(workflowBindingApi, 'bind')
    const { wrapper, router } = await mountWizard()
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()
    expect(bind).not.toHaveBeenCalled()
    expect(router.currentRoute.value.query.sourceId).toBe('9001')
  })

  // 10-22：分类只选业务目录；业务目录走分类—源关系表，源的系统目录留空，建完把源加进所选目录
  it('分类只展示业务目录；源的系统目录留空，建完加入所选业务目录', async () => {
    const siteCreate = vi.spyOn(siteApi, 'siteCreate').mockResolvedValue({ ok: true, siteId: '11825', sourceId: '9001', sourceIds: ['9001', '9002'] })
    vi.spyOn(flowCenterApi, 'save').mockResolvedValue({ id: '1', name: 'x', definition: {} as never, updatedAt: '' })
    vi.spyOn(workflowBindingApi, 'bind').mockResolvedValue(undefined as never)
    const { wrapper } = await mountWizard()
    expect(wrapper.get('.cat-stub').attributes('root-id')).toBe('-2')
    await wrapper.get('input.rc-input').setValue('向导测试站')
    await flushPromises()
    await wrapper.get('.rc-btn.primary').trigger('click')
    await flushPromises()
    expect((siteCreate.mock.calls[0][0] as { dirId?: string }).dirId).toBe('7')
    expect((siteCreate.mock.calls[0][1] as { dirId?: string }[]).map((src) => src.dirId)).toEqual([''])
    expect(addSourcesToBizDir).toHaveBeenCalledWith('7', ['9001', '9002'])
  })
})
