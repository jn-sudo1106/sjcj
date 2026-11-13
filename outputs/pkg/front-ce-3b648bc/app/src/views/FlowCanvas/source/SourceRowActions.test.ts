// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sourceApi, type Source } from '@/api'
import SourceRowActions from './SourceRowActions.vue'

const source: Source = {
  sourceId: '2', siteId: '20', siteName: '网站 B',
  name: '跨网站的公告', url: 'https://example.com/notice',
  configId: '', mainTable: '', owner: 'admin', state: 'C',
}

const launchMock = vi.fn()
const codeShowMock = vi.fn()
// 子组件都换成能断言入参的替身：这些动作自己另有单测（SnatchLauncher / CodeConfigButton / EditSourceDialog），
// 这里只验「右键菜单把正确的源交给了哪个动作」。
const SnatchStub = {
  name: 'SnatchLauncher',
  setup(_props: unknown, { expose }: { expose: (api: Record<string, unknown>) => void }) {
    expose({ launch: launchMock })
    return () => null
  },
}
const EditStub = {
  name: 'EditSourceDialog',
  props: ['open', 'source', 'quick'],
  emits: ['update:open', 'saved', 'directories-changed'],
  template: '<div data-testid="edit-stub" />',
}
const MoveStub = {
  name: 'ChangeSiteDialog',
  props: ['sourceIds'],
  emits: ['close', 'saved'],
  template: '<div data-testid="move-stub" />',
}
const CodeStub = {
  name: 'CodeConfigButton',
  setup(_props: unknown, { expose }: { expose: (api: Record<string, unknown>) => void }) {
    expose({ show: codeShowMock })
    return () => null
  },
}

function mountMenu() {
  return mount(SourceRowActions, {
    global: { stubs: { SnatchLauncher: SnatchStub, EditSourceDialog: EditStub, ChangeSiteDialog: MoveStub, CodeConfigButton: CodeStub } },
  })
}
async function openMenu(wrapper: ReturnType<typeof mountMenu>, target: Source = source, x = 60, y = 40) {
  wrapper.vm.open({ clientX: x, clientY: y } as MouseEvent, target)
  await flushPromises()
}

beforeEach(() => {
  launchMock.mockReset()
  codeShowMock.mockReset()
  vi.spyOn(ElMessage, 'success').mockImplementation(() => ({ close: () => {} }) as never)
  vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close: () => {} }) as never)
})
afterEach(() => vi.restoreAllMocks())

describe('SourceRowActions · 搜索结果右键菜单', () => {
  it('菜单项顺序与站内右键菜单一致，并多一个「编辑源」', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    expect(wrapper.findAll('[role="menuitem"]').map((item) => item.text()))
      .toEqual(['编辑源', '重命名', '发起抓取', '代码生成', '发指定队列', '复制源…', '更换网站…', '删除源'])
    expect(wrapper.find('[data-testid="search-menu-delete"]').classes()).toContain('danger')
    expect(wrapper.find('.sra-menu').exists()).toBe(true)
    wrapper.unmount()
  })

  it('编辑源：打开编辑弹窗并带上被右击的源，保存后回抛 edited', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-edit"]').trigger('click')
    await flushPromises()

    const editor = wrapper.getComponent({ name: 'EditSourceDialog' })
    expect(editor.props('source')).toMatchObject({ sourceId: '2', name: '跨网站的公告' })
    expect(editor.props('open')).toBe(true)
    // 传了 quick（快捷编辑支持改所属网站）；替身没声明 Boolean 类型，空串即「有这个属性」
    expect(editor.props('quick')).toBeDefined()

    editor.vm.$emit('saved', { ...source, name: '改名后的公告' })
    await flushPromises()
    expect(wrapper.emitted('changed')?.[0]).toEqual(['edited', expect.objectContaining({ sourceId: '2', name: '改名后的公告' })])
    expect(wrapper.findComponent({ name: 'EditSourceDialog' }).exists()).toBe(false)
    wrapper.unmount()
  })

  it('重命名：弹窗填名称 → sourceUpdate，并回抛 renamed', async () => {
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '  新名称  ' } as never)
    const update = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true, message: '已保存' })
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-rename"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ sourceId: '2', name: '新名称' }))
    expect(wrapper.emitted('changed')?.[0]).toEqual(['renamed', expect.objectContaining({ name: '新名称' })])
    wrapper.unmount()
  })

  it('重命名：名称没变或用户取消时不发请求，也不报错', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '跨网站的公告' } as never)
    const update = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-rename"]').trigger('click')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()

    prompt.mockRejectedValue('cancel')
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-rename"]').trigger('click')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
    expect(wrapper.emitted('changed')).toBeUndefined()
    wrapper.unmount()
  })

  it('删除源：二次确认后 deleteSource，并回抛 deleted', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const del = vi.spyOn(sourceApi, 'deleteSource').mockResolvedValue({ ok: true })
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-delete"]').trigger('click')
    await flushPromises()

    expect(del).toHaveBeenCalledWith(['2'])
    expect(wrapper.emitted('changed')?.[0]).toEqual(['deleted', expect.objectContaining({ sourceId: '2' })])
    wrapper.unmount()
  })

  it('发起抓取 / 发指定队列：交给 SnatchLauncher，队列名透传', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-launch"]').trigger('click')
    await flushPromises()
    expect(launchMock).toHaveBeenCalledWith('2', expect.objectContaining({ onSuccess: expect.any(Function) }))

    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: 'queue-1' } as never)
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-snatch-queue"]').trigger('click')
    await flushPromises()
    expect(launchMock).toHaveBeenLastCalledWith('2', expect.objectContaining({ queue: 'queue-1' }))
    wrapper.unmount()
  })

  it('代码生成：把这一行作为 sources 打开代码生成', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-code"]').trigger('click')
    await flushPromises()
    expect(codeShowMock).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('复制源：默认「原名_copy」，flag=0，并归入原源网站', async () => {
    const copy = vi.spyOn(sourceApi, 'copySourceAndLocate').mockResolvedValue({ ok: true, sourceId: '9', name: '新源' })
    const change = vi.spyOn(sourceApi, 'changeSite').mockResolvedValue({ ok: true, message: 'ok' })
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-copy"]').trigger('click')
    await flushPromises()

    expect((wrapper.get('[data-testid="search-copy-name"]').element as HTMLInputElement).value).toBe('跨网站的公告_copy')
    expect((wrapper.get('[data-testid="search-copy-url"]').element as HTMLInputElement).value).toBe('https://example.com/notice')
    await wrapper.get('[data-testid="search-copy-name"]').setValue('新源')
    await wrapper.get('[data-testid="search-copy-submit"]').trigger('click')
    await flushPromises()

    expect(copy).toHaveBeenCalledWith({ sourceId: '2', name: '新源', url: 'https://example.com/notice', flag: 0 })
    expect(change).toHaveBeenCalledWith(['9'], '20')
    expect(wrapper.find('[data-testid="search-copy-dialog"]').exists()).toBe(false)
    expect(wrapper.emitted('changed')?.[0]).toEqual(['copied', expect.objectContaining({ sourceId: '9', name: '新源' })])
    wrapper.unmount()
  })

  it('更换网站：复用采集资产的批量弹窗，确认后回抛 moved', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await wrapper.get('[data-testid="search-menu-move"]').trigger('click')
    await flushPromises()

    const dialog = wrapper.getComponent({ name: 'ChangeSiteDialog' })
    expect(dialog.props('sourceIds')).toEqual(['2'])
    dialog.vm.$emit('saved')
    await flushPromises()
    expect(wrapper.emitted('changed')?.[0]).toEqual(['moved', expect.objectContaining({ sourceId: '2' })])
    wrapper.unmount()
  })

  it('点击菜单内部不会先关掉菜单（捕获阶段的 pointerdown 不能误伤 click）', async () => {
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '新名称' } as never)
    const update = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
    const wrapper = mountMenu()
    await openMenu(wrapper)
    const item = wrapper.get('[data-testid="search-menu-rename"]')
    item.element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.sra-menu').exists()).toBe(true)

    await item.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ name: '新名称' }))
    wrapper.unmount()
  })

  it('点击菜单外部或按 Esc 关闭菜单', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    window.dispatchEvent(new Event('pointerdown'))
    await flushPromises()
    expect(wrapper.find('.sra-menu').exists()).toBe(false)

    await openMenu(wrapper)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper.find('.sra-menu').exists()).toBe(false)
    wrapper.unmount()
  })

  it('禁用的源不能发起抓取', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper, { ...source, disabled: true })
    const launch = wrapper.get('[data-testid="search-menu-launch"]')
    expect(launch.attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="search-menu-snatch-queue"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})