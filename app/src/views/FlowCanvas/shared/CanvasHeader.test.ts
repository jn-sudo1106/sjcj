// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import CanvasHeader from './CanvasHeader.vue'
import { useFlowStore } from '@/stores/flow'
import { flowCenterApi } from '@/api'

async function mountHeader() {
  vi.spyOn(flowCenterApi, 'list').mockResolvedValue([])
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/canvas', component: { template: '<div />' } }],
  })
  await router.push({ path: '/canvas', query: { sourceId: 'source-a' } })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(CanvasHeader, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return wrapper
}

describe('CanvasHeader · 参数源摘要（0721 会议 T5）', () => {
  it('普通源：摘要展示 url', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '普通源', url: 'https://example.com/notice', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' },
      [],
    )
    await flushPromises()

    expect(wrapper.get('.ch-sub').text()).toBe('https://example.com/notice')
  })

  it('参数源：摘要展示"参数源 · 模板 · N 个参数占位符"，不展示原始 url', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      {
        sourceId: 'source-a', name: '参数源测试', url: '', configId: '', mainTable: 'T1', owner: 'admin', state: 'C',
        kind: 'param', baseUrl: 'http://base', urlTemplate: 'http://base-$PARAM$_913-$PARAM$_912',
        paramRefs: [{ paramId: '913', group: null }, { paramId: '912', group: null }],
      },
      [],
    )
    await flushPromises()

    expect(wrapper.get('.ch-sub').text()).toBe('参数源 · http://base-$PARAM$_913-$PARAM$_912 · 2 个参数占位符')
  })
})

// 返回按钮（0828 W5-6/7 合并）：不回网站列表，回**当前源所属网站**的源视图。
describe('CanvasHeader · 返回源视图', () => {
  it('有所属网站时回该网站的源视图', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-a', name: '源 A', url: 'https://x', configId: '', mainTable: 'T1', owner: 'admin', state: 'C', siteId: '7' } as never,
      [], null,
    )
    await flushPromises()
    const back = wrapper.findAll('button').find((b) => b.text().includes('返回'))!
    expect(back.text()).toContain('返回源视图')
    await back.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.query).toEqual({ siteId: '7', view: 'source' })
  })

  it('游离源（无网站归属）退回网站列表，而不是跳到一个不存在的网站', async () => {
    const wrapper = await mountHeader()
    const flow = useFlowStore()
    flow.loadFromSource(
      { sourceId: 'source-b', name: '源 B', url: 'https://y', configId: '', mainTable: 'T1', owner: 'admin', state: 'C' } as never,
      [], null,
    )
    await flushPromises()
    await wrapper.findAll('button').find((b) => b.text().includes('返回'))!.trigger('click')
    await flushPromises()
    expect(wrapper.vm.$router.currentRoute.value.path).toBe('/collect')
  })
})
