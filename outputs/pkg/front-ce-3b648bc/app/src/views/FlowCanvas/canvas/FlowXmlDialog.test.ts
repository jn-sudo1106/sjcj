// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FlowXmlDialog from './FlowXmlDialog.vue'

const dialogStub = {
  props: ['modelValue'],
  template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
}

describe('FlowXmlDialog', () => {
  it('未保存或校验失败时禁用 XML 导出', () => {
    const wrapper = mount(FlowXmlDialog, {
      props: { open: true, xml: '<flow/>', flowId: 'flow-1', canExport: false },
      global: { stubs: { 'el-dialog': dialogStub } },
    })

    expect(wrapper.find('[data-testid="export-xml"]').attributes('disabled')).toBeDefined()
  })

  it('允许导出时以 XML Blob 下载', async () => {
    const createObjectURL = vi.fn(() => 'blob:flow')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const wrapper = mount(FlowXmlDialog, {
      props: { open: true, xml: '<flow/>', flowId: 'flow-1', canExport: true },
      global: { stubs: { 'el-dialog': dialogStub } },
    })
    const click = vi.fn()
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName) =>
      tagName === 'a' ? { click, href: '', download: '' } as unknown as HTMLElement : createElement(tagName),
    )

    await wrapper.find('[data-testid="export-xml"]').trigger('click')

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:flow')
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
})
