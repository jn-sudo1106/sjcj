// @vitest-environment jsdom
// 「更换」弹窗：打开后 sameConfigs + 自动接 configPaged；触底继续翻页，没有「载入更多」按钮。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SelectExistingConfigDialog from './SelectExistingConfigDialog.vue'
import { configApi, type Config } from '@/api'

const dialogStub = {
  props: ['modelValue'],
  template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
}

const SAME: Config[] = [
  { configId: '500', name: '默认', enabled: true, domain: 'local' },
  { configId: '1400215', name: '关键词同步', enabled: true, domain: 'baidu' },
]

const PAGE1: Config[] = [
  { configId: '1400215', name: '关键词同步', enabled: true },
  { configId: '1400917', name: '1400917-规则处理', enabled: true },
  { configId: '1400774', name: '证券之星列表配置', enabled: true },
]

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mountOpen() {
  vi.spyOn(configApi, 'sameConfigs').mockResolvedValue(SAME)
  vi.spyOn(configApi, 'configPaged').mockResolvedValue({ total: 120, list: PAGE1 })
  const wrapper = mount(SelectExistingConfigDialog, {
    props: { open: true, sourceId: '430016398' },
    global: {
      stubs: { 'el-dialog': dialogStub },
      directives: { loading: () => {} },
    },
  })
  return wrapper
}

describe('SelectExistingConfigDialog', () => {
  it('打开后自动接全库分页，没有「载入更多」按钮和底部说明', async () => {
    const wrapper = mountOpen()
    await flushPromises()

    expect(configApi.sameConfigs).toHaveBeenCalledWith('430016398', undefined)
    expect(configApi.configPaged).toHaveBeenCalledWith({ page: 1, size: 50 })
    expect(wrapper.text()).toContain('关键词同步')
    expect(wrapper.text()).toContain('1400917-规则处理')
    expect(wrapper.text()).not.toContain('载入更多配置')
    expect(wrapper.text()).not.toContain('选中后只改本节点引用的配置')
    expect(wrapper.findAll('.secd-id').filter((n) => n.text() === '#1400215')).toHaveLength(1)
  })

  it('按配置 ID 搜索会打 configPaged，不只在同资源那几条里筛', async () => {
    vi.useFakeTimers()
    const wrapper = mountOpen()
    await flushPromises()
    vi.spyOn(configApi, 'configPaged').mockResolvedValue({
      total: 1,
      list: [{ configId: '1400917', name: '1400917-规则处理', enabled: true }],
    })

    await wrapper.get('.secd-search').setValue('1400917')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    expect(configApi.configPaged).toHaveBeenCalledWith({ keyword: '1400917', page: 1, size: 50 })
    expect(wrapper.text()).toContain('1400917-规则处理')
  })

  // 2026-09-29：流程入口（ROOT）换配置不传 sourceId。此前 loadMore 无源直接 return、hasMore 恒真，
  // 列表容器有高度时 fillIfShort ↔ onReachEnd 在微任务里无限空转，真实页面点「更换」直接卡死。
  // jsdom 的 clientHeight 恒为 0 会跳过补满逻辑，这里显式给出「容器有高度、内容没撑满」。
  function mountWithoutSource() {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100)
    const same = vi.spyOn(configApi, 'sameConfigs')
    const wrapper = mount(SelectExistingConfigDialog, {
      props: { open: true },
      global: { stubs: { 'el-dialog': dialogStub }, directives: { loading: () => {} } },
    })
    return { wrapper, same }
  }

  it('不传 sourceId（流程入口换配置）：直接列全库，内容没撑满时翻到底就停，不空转', async () => {
    const paged = vi.spyOn(configApi, 'configPaged').mockResolvedValue({ total: 120, list: PAGE1 })
    const { wrapper, same } = mountWithoutSource()
    await flushPromises()

    expect(same).not.toHaveBeenCalled()
    expect(paged.mock.calls.map((c) => c[0])).toEqual([
      { page: 1, size: 50 },
      { page: 2, size: 50 },
      { page: 3, size: 50 },
    ])
    expect(wrapper.text()).toContain('1400917-规则处理')
    expect(wrapper.text()).toContain('流程入口（ROOT）可挂任意配置')
    expect(wrapper.text()).not.toContain('当前不是源画布')
  })

  it('不传 sourceId 且全库接口失败：只请求一次，不在错误上反复重试', async () => {
    const paged = vi.spyOn(configApi, 'configPaged').mockRejectedValue(new Error('服务器异常'))
    mountWithoutSource()
    await flushPromises()
    expect(paged).toHaveBeenCalledTimes(1)
  })
})
