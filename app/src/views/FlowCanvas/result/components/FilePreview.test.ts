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
  it('html 预览：给采集页注入兜底排版样式再渲染，原始字节不动', async () => {
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      created.push(b as Blob)
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('<html><body><a href="/x">链接</a></body></html>'))

    const wrapper = mount(FilePreview, { props: { path: '/data/content.html', name: 'content.html', ext: 'html' } })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-preview-html"]').exists()).toBe(true)
    expect(created).toHaveLength(1)
    const html = await created[0].text()
    expect(html.startsWith('<style>')).toBe(true)
    expect(html).toContain('max-width:820px')
    expect(html).toContain('<html><body><a href="/x">链接</a></body></html>')
    expect(created[0].type).toContain('text/html')
  })

  it('html 预览：给了源站地址时前置 <base href>，让相对资源回源站；非法地址忽略', async () => {
    const created: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      created.push(b as Blob)
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('<body>x</body>'))

    const w1 = mount(FilePreview, {
      props: { path: '/c.html', name: 'c.html', ext: 'html', externalUrl: 'https://www.sanyoumed.com/zh/news/abc' },
    })
    await flushPromises()
    const h1 = await created[0].text()
    expect(h1.startsWith('<base href="https://www.sanyoumed.com/zh/news/abc">')).toBe(true)
    expect(h1).toContain('<style>')
    w1.unmount()

    created.length = 0
    const w2 = mount(FilePreview, {
      props: { path: '/c.html', name: 'c.html', ext: 'html', externalUrl: 'javascript:alert(1)' },
    })
    await flushPromises()
    expect((await created[0].text()).startsWith('<style>')).toBe(true)
    w2.unmount()
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
