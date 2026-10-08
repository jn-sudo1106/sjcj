// @vitest-environment jsdom
// 「全部 · 网站名」页签的名字（2026-09-17 用户提：页签上显示成「全部 · 11」这种裸 ID）。
//
// 成因：ensureSiteTab 只拿到 siteId 时用 siteId 顶着当名字，指望 SiteDetailView 拿到
// site/detail 后再补真名——可 SiteDetailView **只在网站态才挂载**。从源进来（深链、点源页签、
// 数据钻取）时它根本不挂，名字就永远补不上。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import FlowCanvas from './index.vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { siteApi, sourceApi, workflowBindingApi, type Source } from '@/api'

const SOURCE = {
  sourceId: '430002125', name: '新浪财经-证券-股市及时雨', url: 'http://x.test/', configId: '1400917',
  mainTable: '6200026', owner: 'a', state: 'C',
} as Source

async function mountCanvas(query: Record<string, string>, source: Source = SOURCE, seed?: () => void) {
  vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(source)
  vi.spyOn(sourceApi, 'sourceSteps').mockResolvedValue([])
  vi.spyOn(sourceApi, 'stepConfigDetails').mockResolvedValue([])
  vi.spyOn(workflowBindingApi, 'list').mockResolvedValue([])
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/canvas', component: { template: '<div />' } }],
  })
  await router.push({ path: '/canvas', query })
  await router.isReady()
  const pinia = createPinia()
  setActivePinia(pinia)
  seed?.()
  const wrapper = mount(FlowCanvas, {
    global: {
      plugins: [pinia, router],
      directives: { loading: {} },
      stubs: {
        FlowBoard: true, ResultView: true, NodeInspector: true, SiteSourceSwitcher: true,
        SourceTabsBar: true, TaskView: true, FileView: true, SiteDetailView: true, CompareSplit: true,
        LoginConfigSelectDialog: true, NewSiteWizard: true,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('源态下「全部 · 网站名」页签的名字', () => {
  // 少了它，上一条用例调过的 siteDetail 会算进下一条的调用次数——
  // 同名 spy 在 vitest 里是同一个对象，`not.toHaveBeenCalled()` 会拿到陈旧计数（单跑过、全跑挂）
  afterEach(() => vi.restoreAllMocks())

  it('从源进来也把网站名补上，不留裸 siteId', async () => {
    sessionStorage.clear()
    const detail = vi.spyOn(siteApi, 'siteDetail').mockResolvedValue({ siteId: '15', name: '涨停板' } as never)
    await mountCanvas({ siteId: '15', sourceId: SOURCE.sourceId, view: 'flow' }, { ...SOURCE, siteId: '15' } as Source)
    await flushPromises()

    expect(detail).toHaveBeenCalledWith('15')
    expect(useWorkspaceStore().siteTabs.map((t) => t.name)).toEqual(['涨停板'])
  })

  // 之前进过这个网站（页签上已经是真名），再从它名下的源进来不该为一个已知的名字再打一次接口
  it('已经有真名就不再请求一次', async () => {
    sessionStorage.clear()
    const detail = vi.spyOn(siteApi, 'siteDetail').mockResolvedValue({ siteId: '15', name: '涨停板' } as never)
    await mountCanvas(
      { siteId: '15', sourceId: SOURCE.sourceId, view: 'flow' },
      { ...SOURCE, siteId: '15' } as Source,
      () => useWorkspaceStore().ensureSiteTab('15', '涨停板'),
    )
    await flushPromises()

    expect(detail).not.toHaveBeenCalled()
    expect(useWorkspaceStore().siteTabs.map((t) => t.name)).toEqual(['涨停板'])
  })

  it('查不到网站名不报错，页签退化成 siteId 照常可用', async () => {
    sessionStorage.clear()
    vi.spyOn(siteApi, 'siteDetail').mockRejectedValue(new Error('网络挂了'))
    await mountCanvas({ siteId: '15', sourceId: SOURCE.sourceId, view: 'flow' }, { ...SOURCE, siteId: '15' } as Source)
    await flushPromises()

    expect(useWorkspaceStore().siteTabs.map((t) => t.name)).toEqual(['15'])
  })
})
