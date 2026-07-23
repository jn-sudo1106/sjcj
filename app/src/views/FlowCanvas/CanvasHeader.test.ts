// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import CanvasHeader from './CanvasHeader.vue'
import { useFlowStore } from '../../stores/flow'
import { flowTemplateApi } from '../../api'

async function mountHeader() {
  vi.spyOn(flowTemplateApi, 'list').mockResolvedValue([])
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

    expect(wrapper.get('.ch-sub').text()).toBe('参数子源 · http://base-$PARAM$_913-$PARAM$_912 · 2 个参数占位符')
  })
})
