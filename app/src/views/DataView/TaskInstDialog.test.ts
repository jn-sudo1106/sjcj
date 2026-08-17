// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import TaskInstDialog from './TaskInstDialog.vue'
import { dataApi } from '../../api'

describe('TaskInstDialog · 旧任务实例字段迁移', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  it('保留旧页的文件 ID 筛选和主题列，并把文件 ID 传给任务分页接口', async () => {
    const taskPaged = vi.spyOn(dataApi, 'taskInstPaged').mockResolvedValue({ total: 0, list: [] })
    wrapper = mount(TaskInstDialog, {
      props: { modelValue: false, sourceId: '391003973', fileId: 'file-01' },
      global: { plugins: [ElementPlus] },
    })

    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect((wrapper.find('input[placeholder="文件ID"]').element as HTMLInputElement).value).toBe('file-01')
    expect(taskPaged).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-01', sourceId: '391003973' }))
    expect(wrapper.text()).toContain('主题')

    await wrapper.find('input[placeholder="文件ID"]').setValue('file-02')
    await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click')
    await flushPromises()

    expect(taskPaged).toHaveBeenLastCalledWith(expect.objectContaining({ fileId: 'file-02' }))
  })
})
