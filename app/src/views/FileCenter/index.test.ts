// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import FileCenter from './index.vue'
import { sourceApi } from '@/api'
import { dirNode, dirPath, loadDirChildren, loadDirPath, searchDirs, type DirNode } from '@/api/sourceDirs'

// 目录树走真实 API 的帮助函数，测试里整体替掉；这里只验证 FileCenter 怎么用它们
vi.mock('@/api/sourceDirs', () => ({
  BIZ_DIR_ROOT_ID: '-2',
  loadDirChildren: vi.fn(),
  searchDirs: vi.fn(),
  loadDirPath: vi.fn(),
  dirPath: vi.fn(() => []),
  dirNode: vi.fn(() => undefined),
}))

// el-select 之类的 Element Plus 组件走真实渲染（不要被 shallowMount 桩掉）
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub

const childrenMock = vi.mocked(loadDirChildren)
const searchMock = vi.mocked(searchDirs)
const loadPathMock = vi.mocked(loadDirPath)
const pathMock = vi.mocked(dirPath)
const nodeMock = vi.mocked(dirNode)

/** 目录树：根层两个目录，dir-1 下一个子目录，dir-2 是叶子 */
const tree: Record<string, DirNode[]> = {
  '': [
    { id: 'dir-1', name: '财经', parentId: '' },
    { id: 'dir-2', name: '资讯', parentId: '' },
  ],
  'dir-1': [{ id: 'dir-1-1', name: '财经子类', parentId: 'dir-1' }],
  'dir-2': [],
}
const nodeIndex: Record<string, DirNode> = {
  'dir-1': { id: 'dir-1', name: '财经', parentId: '' },
  'dir-1-1': { id: 'dir-1-1', name: '财经子类', parentId: 'dir-1' },
  'dir-2': { id: 'dir-2', name: '资讯', parentId: '' },
}
const pathOf: Record<string, string[]> = {
  'dir-1': ['财经'],
  'dir-1-1': ['财经', '财经子类'],
  'dir-2': ['资讯'],
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/files', component: FileCenter }],
  })
}

// 方案 A：右栏只剩 SiteFileView，FileCenter 把目录范围作为 sourceScopeDirId / scopeLabel 传下去
const fileViewStub = {
  name: 'SiteFileView',
  props: ['initialSourceId', 'sourceScopeDirId', 'scopeLabel'],
  template: '<div class="sfv-stub" />',
}

let current: VueWrapper | null = null

async function mountAt(path: string) {
  const router = makeRouter()
  await router.push(path)
  const wrapper = mount(FileCenter, {
    attachTo: document.body,
    global: { plugins: [router, ElementPlus], stubs: { SiteFileView: fileViewStub } },
  })
  current = wrapper
  await settle()
  return { router, wrapper }
}

function fileView(wrapper: VueWrapper) {
  return wrapper.findComponent({ name: 'SiteFileView' })
}

/** 目录树/深链恢复都走异步，等宏任务把 el-icon 过渡与路由替换一起跑完 */
async function settle() {
  await flushPromises()
  await new Promise((resolve) => setTimeout(resolve, 60))
  await flushPromises()
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('FileCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    childrenMock.mockImplementation(async (_kind, parentId = '') => tree[parentId] ?? [])
    nodeMock.mockImplementation((id: string) => nodeIndex[id])
    pathMock.mockImplementation((id: string) => pathOf[id] ?? [])
    loadPathMock.mockImplementation(async (id: string) => {
      if (!nodeIndex[id]) throw new Error(`系统目录 #${id} 不存在`)
      return pathOf[id] ?? []
    })
    searchMock.mockResolvedValue([])
  })

  afterEach(() => {
    current?.unmount()
    current = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('默认是全部业务目录：左栏是源管理同款业务目录面板，右栏没有范围条、不限定源', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged')
    const { wrapper, router } = await mountAt('/files')

    const panel = wrapper.get('[data-testid="file-center-dir-panel"]')
    expect(panel.classes()).toContain('sdp')
    expect(panel.classes()).toContain('biz')
    expect(wrapper.get('[data-testid="file-center-dir-kind"]').text()).toBe('业务目录')
    expect(wrapper.find('[data-testid="file-center-dir-collapse"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="file-center-dir-search"]').attributes('placeholder')).toBe('搜索目录')
    expect(wrapper.findAll('[data-testid="file-center-dir-row"]')).toHaveLength(2)
    expect(wrapper.get('[data-testid="file-center-dir-all"]').classes()).toContain('on')
    expect(wrapper.get('[data-testid="file-center-dir-tree"]').text()).toContain('财经')
    expect(wrapper.text()).toContain('目录的新增、改名、删除在「系统设置 → 分类目录」')

    // 方案 A：不再有顶部范围条/目录内源下拉/常驻提示行
    expect(wrapper.find('[data-testid="file-center-toolbar"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="file-center-source-select"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="file-center-scope-notice"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="file-center-dir-paging-note"]').exists()).toBe(false)

    const view = fileView(wrapper)
    expect(view.props('initialSourceId')).toBeUndefined()
    expect(view.props('sourceScopeDirId')).toBeUndefined()
    expect(view.props('scopeLabel')).toBe('')
    expect(router.currentRoute.value.fullPath).toBe('/files')
    // 目录范围只影响右栏源候选，FileCenter 自己不再发源查询
    expect(paged).not.toHaveBeenCalled()
  })

  it('左栏可折叠成 36px 竖排 rail，再点恢复面板', async () => {
    const { wrapper } = await mountAt('/files')

    await wrapper.get('[data-testid="file-center-dir-collapse"]').trigger('click')
    expect(wrapper.find('[data-testid="file-center-dir-panel"]').exists()).toBe(false)
    const rail = wrapper.get('[data-testid="file-center-dir-rail"]')
    expect(rail.text()).toContain('业务目录')

    await rail.trigger('click')
    expect(wrapper.find('[data-testid="file-center-dir-panel"]').exists()).toBe(true)
  })

  it('子目录懒加载：点开父目录才请求它的子级', async () => {
    const { wrapper } = await mountAt('/files')
    expect(wrapper.text()).not.toContain('财经子类')
    expect(childrenMock).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="file-center-dir-caret"]').trigger('click')
    await settle()

    expect(childrenMock).toHaveBeenLastCalledWith('biz', 'dir-1')
    expect(wrapper.text()).toContain('财经子类')
  })

  it('选目录同步 URL 并把目录范围交给 SiteFileView（表头面包屑由右栏承载）', async () => {
    const { wrapper, router } = await mountAt('/files')
    await wrapper.findAll('[data-testid="file-center-dir-name"]')[0].trigger('click')
    await settle()

    expect(router.currentRoute.value.fullPath).toBe('/files?dirId=dir-1')
    expect(wrapper.get('[data-testid="file-center-dir-row"]').classes()).toContain('on')
    const view = fileView(wrapper)
    expect(view.props('sourceScopeDirId')).toBe('dir-1')
    expect(view.props('scopeLabel')).toBe('财经')
    expect(view.props('initialSourceId')).toBeUndefined()
  })

  it('深链 ?dirId= 恢复目录：展开祖先、URL 保持、面包屑用 dirPath 拼接', async () => {
    const { wrapper, router } = await mountAt('/files?dirId=dir-1-1')

    expect(router.currentRoute.value.fullPath).toBe('/files?dirId=dir-1-1')
    expect(loadPathMock).toHaveBeenCalledWith('dir-1-1')
    const view = fileView(wrapper)
    expect(view.props('sourceScopeDirId')).toBe('dir-1-1')
    expect(view.props('scopeLabel')).toBe('财经 / 财经子类')
    expect(view.props('initialSourceId')).toBeUndefined()
  })

  it('深链 ?dirId=&sourceId= 把源原样交给右栏，不在 FileCenter 内重复校验目录归属', async () => {
    const paged = vi.spyOn(sourceApi, 'sourcePaged')
    const { wrapper, router } = await mountAt('/files?dirId=dir-1&sourceId=src-a')

    expect(router.currentRoute.value.fullPath).toBe('/files?dirId=dir-1&sourceId=src-a')
    const view = fileView(wrapper)
    expect(view.props('sourceScopeDirId')).toBe('dir-1')
    expect(view.props('initialSourceId')).toBe('src-a')
    expect(view.props('scopeLabel')).toBe('财经')
    // 越界清源由 SiteFileView 的 sourceScopeDirId watcher 负责，FileCenter 不发校验请求
    expect(paged).not.toHaveBeenCalled()
  })

  it('只带 ?sourceId= 也能恢复单源范围（不要求先选目录）', async () => {
    const { wrapper, router } = await mountAt('/files?sourceId=src-b')

    expect(router.currentRoute.value.fullPath).toBe('/files?sourceId=src-b')
    const view = fileView(wrapper)
    expect(view.props('initialSourceId')).toBe('src-b')
    expect(view.props('sourceScopeDirId')).toBeUndefined()
    expect(view.props('scopeLabel')).toBe('')
  })

  it('旧 ?siteId= 深链：忽略网站范围、一次性提示、URL 清掉 siteId，不算错误', async () => {
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({}) as never)
    const { wrapper, router } = await mountAt('/files?siteId=site-legacy&dirId=dir-1')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('网站范围已改为按源查看')
    expect(String(warn.mock.calls[0][0])).toContain('site-legacy')
    // 一次性：URL 里去掉 siteId 后重新进入，不再重复提示
    expect(router.currentRoute.value.fullPath).toBe('/files?dirId=dir-1')
    expect(wrapper.find('[data-testid="file-center-scope-notice"]').exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(fileView(wrapper).props('sourceScopeDirId')).toBe('dir-1')
    expect(String(warn.mock.calls[0][0])).not.toContain('不存在或无权访问')
  })

  it('目录搜索走服务端，命中项带父级路径，点选后按该目录取范围', async () => {
    searchMock.mockResolvedValue([{ id: 'dir-1-1', name: '财经子类', parentId: 'dir-1' }])
    const { wrapper, router } = await mountAt('/files')

    await wrapper.get('[data-testid="file-center-dir-search"]').setValue('财经')
    await wait(400)
    await settle()

    expect(searchMock).toHaveBeenCalledWith('biz', '财经')
    const hit = wrapper.get('[data-testid="file-center-dir-hit"]')
    expect(hit.text()).toContain('财经子类')
    expect(hit.text()).toContain('财经')

    await hit.trigger('click')
    await settle()
    expect(router.currentRoute.value.fullPath).toBe('/files?dirId=dir-1-1')
    expect(fileView(wrapper).props('scopeLabel')).toBe('财经 / 财经子类')
  })

  it('目录搜索无命中时提示「没有匹配的目录」', async () => {
    searchMock.mockResolvedValue([])
    const { wrapper } = await mountAt('/files')

    await wrapper.get('[data-testid="file-center-dir-search"]').setValue('不存在')
    await wait(400)
    await settle()

    expect(wrapper.get('[data-testid="file-center-dir-no-match"]').text()).toBe('没有匹配的目录')
  })

  it('目录树加载失败显示真实错误，重试后恢复', async () => {
    childrenMock.mockRejectedValueOnce(new Error('后端 500'))
    const { wrapper } = await mountAt('/files')

    const error = wrapper.get('[data-testid="file-center-dir-panel"] .sdp-empty.err')
    expect(error.text()).toContain('后端 500')
    expect(fileView(wrapper).exists()).toBe(true)

    await wrapper.get('[data-testid="file-center-dir-retry"]').trigger('click')
    await settle()

    expect(childrenMock).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-testid="file-center-dir-row"]')).toHaveLength(2)
    expect(wrapper.find('.sdp-empty.err').exists()).toBe(false)
  })

  it('深链目录不存在时回到全部业务目录并一次性提示', async () => {
    const warn = vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({}) as never)
    const { wrapper, router } = await mountAt('/files?dirId=dir-missing')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('目录不存在或无权访问')
    expect(router.currentRoute.value.fullPath).toBe('/files')
    expect(wrapper.get('[data-testid="file-center-dir-all"]').classes()).toContain('on')
    expect(fileView(wrapper).props('sourceScopeDirId')).toBeUndefined()
  })
})