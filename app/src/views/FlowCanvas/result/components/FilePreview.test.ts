// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FilePreview from './FilePreview.vue'
import * as ossFile from '@/utils/ossFile'

function bufOf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer
}

afterEach(() => vi.restoreAllMocks())

describe('FilePreview', () => {
  it('html 预览：iframe 直接指向 OSS 独立 origin 的绝对地址，前端不 fetch 字节、不造 blob', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const fetchOss = vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('<html></html>'))

    const wrapper = mount(FilePreview, { props: { path: '/qinlong/dds/a.html', name: 'a.html', ext: 'html' } })
    await flushPromises()

    const frame = wrapper.find('[data-testid="file-preview-html"]')
    expect(frame.exists()).toBe(true)
    // 绝对地址（独立 origin），不是同源 /oss 前缀，也不是 blob:
    expect(frame.attributes('src')).toContain(':9102/api/oss/download?fileId=/qinlong/dds/a.html')
    expect(frame.attributes('src')).toMatch(/^https?:\/\//)
    // 跨源文档保留自己的 origin：这两项同时给，只有同源时才可能脱出沙箱，这里恰恰跨源
    expect(frame.attributes('sandbox')).toBe('allow-scripts allow-same-origin')
    // html 不再经过取字节那条路
    expect(fetchOss).not.toHaveBeenCalled()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('html 预览：底部给「新窗口打开」兜底——生产若是 https，页面内嵌 http iframe 会被混合内容拦掉', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('<html></html>'))
    const wrapper = mount(FilePreview, { props: { path: '/qinlong/dds/a.html', name: 'a.html', ext: 'html' } })
    await flushPromises()

    const open = wrapper.find('[data-testid="file-preview-open-window"]')
    expect(open.exists()).toBe(true)
    expect(open.attributes('href')).toContain(':9102/api/oss/download?fileId=/qinlong/dds/a.html')
    expect(open.attributes('target')).toBe('_blank')
    expect(open.attributes('rel')).toContain('noopener')
  })

  it('非 html（如 pdf）仍走取字节 + blob：跨源直取会被 CORS 拒，只有同源 /oss 拿得到字节', async () => {
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      created.push(b as Blob)
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const fetchOss = vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('%PDF-1.7'))

    const wrapper = mount(FilePreview, { props: { path: '/qinlong/a.pdf', name: 'a.pdf', ext: 'pdf' } })
    await flushPromises()

    expect(fetchOss).toHaveBeenCalledWith('/qinlong/a.pdf')
    expect(created).toHaveLength(1)
    expect(created[0].type).toContain('pdf')
    expect(wrapper.find('[data-testid="file-preview-pdf"]').attributes('src')).toBe('blob:mock')
  })

  it('pdf 预览：不注入样式，原样 blob', async () => {
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      created.push(b as Blob)
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('%PDF-1.7 fake'))

    const wrapper = mount(FilePreview, { props: { path: '/data/a.pdf', name: 'a.pdf', ext: 'pdf' } })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-preview-pdf"]').exists()).toBe(true)
    expect(await created[0].text()).toBe('%PDF-1.7 fake')
  })
})
