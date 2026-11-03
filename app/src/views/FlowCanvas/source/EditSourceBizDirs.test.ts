// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import EditSourceBizDirs from './EditSourceBizDirs.vue'
import * as dirs from '@/api/sourceDirs'

vi.mock('@/api/sourceDirs', () => ({
  bizMembership: vi.fn(), loadDirChildren: vi.fn(),
  addSourcesToBizDir: vi.fn(), removeSourcesFromBizDirs: vi.fn(),
}))
const treeSelect = { name: 'ElTreeSelect', props: ['modelValue', 'data', 'disabled'], emits: ['update:modelValue'], template: '<div />' }
const mountPicker = () => mount(EditSourceBizDirs, { props: { sourceId: '123' }, global: { stubs: { 'el-tree-select': treeSelect } } })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(dirs.bizMembership).mockResolvedValue(new Map([['123', ['1', '2']]]))
  vi.mocked(dirs.loadDirChildren).mockImplementation(async (_kind, parentId) => parentId ? [] : [
    { id: '1', name: '目录1', parentId: '' }, { id: '2', name: '目录2', parentId: '' }, { id: '3', name: '目录3', parentId: '' },
  ])
  vi.mocked(dirs.addSourcesToBizDir).mockResolvedValue(undefined)
  vi.mocked(dirs.removeSourcesFromBizDirs).mockResolvedValue(undefined)
})

describe('快捷编辑业务目录', () => {
  it('预选已有目录，保存时先添加新目录再移出取消的目录', async () => {
    const wrapper = mountPicker()
    await flushPromises()
    const select = wrapper.getComponent({ name: 'ElTreeSelect' })
    expect(select.props('modelValue')).toEqual(['1', '2'])
    select.vm.$emit('update:modelValue', ['2', '3'])
    await flushPromises()
    expect(await wrapper.vm.save()).toBe(true)
    expect(dirs.addSourcesToBizDir).toHaveBeenCalledWith('3', ['123'])
    expect(dirs.removeSourcesFromBizDirs).toHaveBeenCalledWith(['1'], ['123'])
    expect(vi.mocked(dirs.addSourcesToBizDir).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(dirs.removeSourcesFromBizDirs).mock.invocationCallOrder[0])
  })
  it('读取失败时不改目录，可重试', async () => {
    vi.mocked(dirs.bizMembership).mockRejectedValueOnce(new Error('网络错误'))
    const wrapper = mountPicker()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('网络错误')
    expect(await wrapper.vm.save()).toBe(false)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent({ name: 'ElTreeSelect' }).props('modelValue')).toEqual(['1', '2'])
  })
  it('新增失败时不移除原有目录', async () => {
    vi.mocked(dirs.addSourcesToBizDir).mockRejectedValue(new Error('保存失败'))
    const wrapper = mountPicker()
    await flushPromises()
    wrapper.getComponent({ name: 'ElTreeSelect' }).vm.$emit('update:modelValue', ['2', '3'])
    await flushPromises()
    await expect(wrapper.vm.save()).rejects.toThrow('保存失败')
    expect(dirs.removeSourcesFromBizDirs).not.toHaveBeenCalled()
  })
})
