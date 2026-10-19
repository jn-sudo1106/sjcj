// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import EditSourceDialog from './EditSourceDialog.vue'
import { sourceApi, type Source } from '@/api'

const source: Source = {
  sourceId: 'source-a', siteId: 'site-a', name: '原源', url: 'https://example.com',
  configId: '', mainTable: '', owner: 'admin', state: 'C',
}

afterEach(() => vi.restoreAllMocks())

describe('EditSourceDialog', () => {
  it('打开时预填源名称和源 URL；保存走 sourceUpdate，成功后 saved 并关闭', async () => {
    const update = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true, message: '已保存' })
    const wrapper = mount(EditSourceDialog, { props: { open: true, source } })

    expect((wrapper.get('[data-testid="edit-source-name"]').element as HTMLInputElement).value).toBe('原源')
    expect((wrapper.get('[data-testid="edit-source-url"]').element as HTMLInputElement).value).toBe('https://example.com')

    await wrapper.get('[data-testid="edit-source-name"]').setValue('改名后')
    await wrapper.get('[data-testid="edit-source-url"]').setValue('https://new.example.com/list')
    await wrapper.get('[data-testid="edit-source-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: 'source-a', name: '改名后', url: 'https://new.example.com/list',
    }))
    expect(wrapper.emitted('saved')?.[0]).toEqual([expect.objectContaining({ name: '改名后', url: 'https://new.example.com/list' })])
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('源名称为空时不提交', async () => {
    const update = vi.spyOn(sourceApi, 'sourceUpdate')
    const wrapper = mount(EditSourceDialog, { props: { open: true, source } })
    await wrapper.get('[data-testid="edit-source-name"]').setValue('  ')
    await wrapper.get('[data-testid="edit-source-save"]').trigger('click')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()
  })

  it('参数源：源 URL 不可改，保存只更新名称', async () => {
    const update = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
    const param: Source = {
      ...source,
      kind: 'param',
      url: '',
      baseUrl: 'http://base',
      urlTemplate: 'http://base-$PARAM$_913',
    }
    const wrapper = mount(EditSourceDialog, { props: { open: true, source: param } })
    const urlInput = wrapper.get<HTMLInputElement>('[data-testid="edit-source-url"]')
    expect(urlInput.element.disabled).toBe(true)
    expect(urlInput.element.value).toBe('http://base-$PARAM$_913')

    await wrapper.get('[data-testid="edit-source-name"]').setValue('参数源改名')
    await wrapper.get('[data-testid="edit-source-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      name: '参数源改名',
      urlTemplate: 'http://base-$PARAM$_913',
    }))
    expect(update.mock.calls[0][0].url).toBe('')
  })
  // 2026-10-19：补旧平台源编辑的「核心参数」（sourceParam）。值从源详情取，取不到就不让改也不提交
  it('核心参数：打开时从源详情读取，改完随 sourceUpdate 提交', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ ...source, coreParam: '{"a":1}' })
    const update = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
    const wrapper = mount(EditSourceDialog, { props: { open: true, source } })
    await flushPromises()

    const box = wrapper.get<HTMLTextAreaElement>('[data-testid="edit-source-core-param"]')
    expect(box.element.disabled).toBe(false)
    expect(box.element.value).toBe('{"a":1}')
    await box.setValue('  {"a":2}  ')
    await wrapper.get('[data-testid="edit-source-save"]').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'source-a', coreParam: '{"a":2}' }))
  })

  it('核心参数：源详情取不到时禁用输入，保存不改动列表里的原值', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockRejectedValue(new Error('网络错误'))
    const update = vi.spyOn(sourceApi, 'sourceUpdate').mockResolvedValue({ ok: true })
    const wrapper = mount(EditSourceDialog, { props: { open: true, source: { ...source, coreParam: '原值' } } })
    await flushPromises()

    expect(wrapper.get<HTMLTextAreaElement>('[data-testid="edit-source-core-param"]').element.disabled).toBe(true)
    await wrapper.get('[data-testid="edit-source-save"]').trigger('click')
    await flushPromises()
    expect(update.mock.calls[0][0].coreParam).toBe('原值')
  })
})
