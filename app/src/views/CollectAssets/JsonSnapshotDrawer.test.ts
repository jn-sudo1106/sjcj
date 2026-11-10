// @vitest-environment jsdom
// 「保存时 JSON」抽屉（旧平台源列表 → 查询 → 保存时Json，2026-11-09 接回）。
// 这层只守接线：按哪个源/任务查、readJson 直链怎么拼、筛选回到第 1 页、错误与空态文案、重新保存要不要确认。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import JsonSnapshotDrawer from './JsonSnapshotDrawer.vue'
import { dataApi, fileApi, type JsonSnapshotRecord, type Source } from '@/api'

// Element Plus 表格内部用 ResizeObserver 量宽，jsdom 没有
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

vi.mock('element-plus', async () => {
  const actual = await vi.importActual<typeof import('element-plus')>('element-plus')
  return {
    ...actual,
    ElMessage: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
    ElMessageBox: { confirm: vi.fn(), alert: vi.fn() },
  }
})

const SOURCE = { sourceId: 'src_1001', name: '海关总署' } as Source

// el-drawer 真实实现会 teleport 到 body，测试里换成直接渲染内容的壳
const ElDrawerStub = {
  name: 'ElDrawer',
  props: ['modelValue', 'title', 'size', 'appendToBody'],
  template: '<div class="jsd-drawer-stub"><slot /></div>',
}

function snapshot(over: Partial<JsonSnapshotRecord> = {}): JsonSnapshotRecord {
  return {
    id: '7400001',
    sourceId: 'src_1001',
    taskId: '88801',
    configId: '70598',
    realName: 'news_main',
    showName: 'snap-7400001.json',
    storePath: '/sense-data/json/snap-7400001.json',
    fileSize: 2048,
    state: 'C',
    createDt: '2026-11-09 10:00:00',
    ...over,
  }
}

function mountDrawer() {
  return mount(JsonSnapshotDrawer, {
    props: { source: SOURCE },
    global: { plugins: [ElementPlus], stubs: { ElDrawer: ElDrawerStub } },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('JsonSnapshotDrawer · 保存时 JSON', () => {
  it('按源加载快照：列快照 ID/表 ID/状态，原始 JSON 给 readJson 直链', async () => {
    const jsonPaged = vi.spyOn(fileApi, 'jsonPaged').mockResolvedValue({
      list: [snapshot(), snapshot({ id: '7400002', state: 'AC', taskId: '88802', fileSize: 512 })],
      total: 2,
    })

    const wrapper = mountDrawer()
    await flushPromises()

    expect(jsonPaged).toHaveBeenCalledWith({
      sourceId: 'src_1001',
      taskId: undefined,
      state: undefined,
      page: 1,
      size: 20,
    })
    expect(wrapper.text()).toContain('共 2 份快照')
    expect(wrapper.text()).toContain('news_main')
    expect(wrapper.text()).toContain('初始')
    expect(wrapper.text()).toContain('被消重')

    const links = wrapper.findAll('[data-testid="json-open"]')
    expect(links).toHaveLength(2)
    expect(links[0]!.attributes('href')).toContain('readJson?id=7400001')
    expect(links[0]!.attributes('href')).toContain('sourceId=src_1001')
    expect(links[0]!.attributes('target')).toBe('_blank')

    wrapper.unmount()
  })

  it('任务 ID 筛选回到第 1 页；清空后按源重查', async () => {
    const jsonPaged = vi.spyOn(fileApi, 'jsonPaged').mockResolvedValue({ list: [], total: 0 })
    const wrapper = mountDrawer()
    await flushPromises()

    const input = wrapper.find('input[data-testid="json-task-filter"]')
    await input.setValue('88801')
    await input.trigger('keyup.enter')
    await flushPromises()

    expect(jsonPaged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceId: 'src_1001', taskId: '88801', page: 1 }))

    const clear = wrapper.findAll('button').find((b) => b.text() === '清空')
    expect(clear).toBeTruthy()
    await clear!.trigger('click')
    await flushPromises()

    expect(jsonPaged).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: undefined, page: 1 }))

    wrapper.unmount()
  })

  it('查询失败只显示一行错误，不抛出去', async () => {
    vi.spyOn(fileApi, 'jsonPaged').mockRejectedValue(new Error('fileJsonPaged 502'))
    const wrapper = mountDrawer()
    await flushPromises()

    expect(wrapper.find('[data-testid="json-table"]').text()).toContain('fileJsonPaged 502')

    wrapper.unmount()
  })

  it('空态区分「该任务没有」与「该源还没有」', async () => {
    const jsonPaged = vi.spyOn(fileApi, 'jsonPaged').mockResolvedValue({ list: [], total: 0 })
    const wrapper = mountDrawer()
    await flushPromises()
    expect(wrapper.text()).toContain('该源还没有保存 JSON 快照')

    const input = wrapper.find('input[data-testid="json-task-filter"]')
    await input.setValue('88801')
    await input.trigger('keyup.enter')
    await flushPromises()

    expect(jsonPaged).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: '88801' }))
    expect(wrapper.text()).toContain('该任务没有保存 JSON 快照')

    wrapper.unmount()
  })

  it('重新保存先二次确认，确认后调 entry/re-save 并刷新列表', async () => {
    const jsonPaged = vi.spyOn(fileApi, 'jsonPaged').mockResolvedValue({ list: [snapshot()], total: 1 })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const reSave = vi.spyOn(dataApi, 'reSave').mockResolvedValue({ message: '' } as never)

    const wrapper = mountDrawer()
    await flushPromises()

    await wrapper.find('[data-testid="json-resave"]').trigger('click')
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(reSave).toHaveBeenCalledWith('src_1001', '7400001')
    expect(jsonPaged).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it('重新保存取消时不调接口', async () => {
    vi.spyOn(fileApi, 'jsonPaged').mockResolvedValue({ list: [snapshot()], total: 1 })
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel')
    const reSave = vi.spyOn(dataApi, 'reSave').mockResolvedValue({ message: '' } as never)

    const wrapper = mountDrawer()
    await flushPromises()

    await wrapper.find('[data-testid="json-resave"]').trigger('click')
    await flushPromises()

    expect(reSave).not.toHaveBeenCalled()

    wrapper.unmount()
  })
})