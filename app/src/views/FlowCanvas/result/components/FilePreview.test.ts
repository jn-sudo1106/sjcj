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
    // 渲染这条路不取字节、不造 blob——iframe 自己按绝对地址加载。
    // （2026-09-11 起另有一次"抓砸了"探测会读文件头部，走 fetchOssFileHead，
    //   只读几十 KB 且不参与渲染，与这里断言的渲染路径是两回事。）
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

  it('正文文本文件（如 K6 的 .txt）：同样提供「新窗口打开」且直连 9102 端口', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(new TextEncoder().encode('正文内容').buffer)
    const wrapper = mount(FilePreview, { props: { path: '/qinlong/dds/content.txt', name: 'content.txt', ext: 'txt' } })
    await flushPromises()

    const open = wrapper.find('[data-testid="file-preview-open-window"]')
    expect(open.exists()).toBe(true)
    expect(open.attributes('href')).toContain(':9102/api/oss/download?fileId=/qinlong/dds/content.txt')
    expect(open.attributes('target')).toBe('_blank')
  })

  it('文本文件当同源 /oss 接口失败时，自动回退到直连 iframe 渲染而不报错中断', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockRejectedValue(new Error('取文件失败（HTTP 404）'))
    const wrapper = mount(FilePreview, { props: { path: '/qinlong/dds/content.txt', name: 'content.txt', ext: 'txt' } })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-preview-error"]').exists()).toBe(false)
    const frame = wrapper.find('[data-testid="file-preview-frame"]')
    expect(frame.exists()).toBe(true)
    expect(frame.attributes('src')).toContain(':9102/api/oss/download?fileId=/qinlong/dds/content.txt')
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

  // 2026-09-11 生产实测：一篇微信文章的存档点开只有「mp.weixin.qq.com 拒绝了我们的连接请求」。
  // 不是预览坏了，是这条数据采坏了——采集被反爬拦下，验证页被当成正文入了库。
  // 这里锁住两件事：判出来时不渲染 iframe（否则就是那片 Chrome 错误页），
  // 以及文案的**主语是采集不是预览**（说"无法预览"等于替对方站点背锅）。
  it('存档是反爬验证页时，说清是采集被拦，而不是渲染成一片错误页', async () => {
    vi.spyOn(ossFile, 'fetchOssFileHead').mockResolvedValue(bufOf(
      '<html><body><div>环境异常</div><p>当前环境异常，完成验证后即可继续访问。</p></body></html>',
    ))
    const wrapper = mount(FilePreview, { props: { path: '/qinlong/dds/a.html', name: 'a.html', ext: 'html' } })
    await flushPromises()

    const blocked = wrapper.find('[data-testid="file-preview-blocked"]')
    expect(blocked.exists()).toBe(true)
    expect(blocked.text()).toContain('采集时被对方站点拦下')
    expect(blocked.text()).not.toContain('无法预览')
    // 引述存档里的原话当证据，比我们自己转述有说服力
    expect(blocked.text()).toContain('完成验证后即可继续访问')
    // 不渲染 iframe：渲染了就会跳去原站被 X-Frame-Options 拒，变成看不懂的错误页
    expect(wrapper.find('[data-testid="file-preview-html"]').exists()).toBe(false)
    // 三条出路仍在（下载 / 打开存档 / 看原文）——被拦时它们才是用户真正要点的
    expect(wrapper.find('[data-testid="file-preview-download"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="file-preview-open-window"]').exists()).toBe(true)
  })

  it('正常文章照常渲染 iframe，不被误判', async () => {
    vi.spyOn(ossFile, 'fetchOssFileHead').mockResolvedValue(bufOf(
      `<html><body><h1>技术跃迁筑行业新生态</h1><div>${'正文内容。'.repeat(80)}</div></body></html>`,
    ))
    const wrapper = mount(FilePreview, { props: { path: '/qinlong/dds/b.html', name: 'b.html', ext: 'html' } })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-preview-blocked"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="file-preview-html"]').exists()).toBe(true)
  })

  // 体积已知且在 MB 级时连探都不探：正常文章不该为这个功能多付一次请求
  it('大体积 html 不做探测', async () => {
    const head = vi.spyOn(ossFile, 'fetchOssFileHead').mockResolvedValue(bufOf('<html></html>'))
    mount(FilePreview, { props: { path: '/qinlong/dds/c.html', name: 'c.html', ext: 'html', size: 3 * 1024 * 1024 } })
    await flushPromises()

    expect(head).not.toHaveBeenCalled()
  })
})

// 0920-02：库里存的正文路径被截成了裸 md5（B22），前端按字段语义猜一个后缀补上去。
// 同一个 md5 下网页快照也在（2026-09-21 实测：.txt 2750 字节 / .html 17612 字节），
// 猜中 txt 之后那份 html 本来没有任何入口能看到。
describe('FilePreview · TXT / HTML 切换（0920-02）', () => {
  const BASE = '/gzh/gzh_msg/MzU2NTQzMjA1OA==/2026-09-21/3e19f177f3db886a6b11384594d8721e'

  it('路径原本没有后缀（给了 basePath）才出现切换，默认停在调用方猜的那个', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('正文'))
    const wrapper = mount(FilePreview, { props: { path: `${BASE}.txt`, basePath: BASE, name: '3e19f177….txt', ext: 'txt' } })
    await flushPromises()

    expect(wrapper.find('[data-testid="file-preview-ext-switch"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="file-preview-ext-txt"]').classes()).toContain('on')
    expect(wrapper.get('[data-testid="file-preview-ext-html"]').classes()).not.toContain('on')
  })

  it('路径自带后缀 / 没给 basePath：不出现切换，行为一如从前', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('x'))
    const withExt = mount(FilePreview, { props: { path: '/qinlong/dds/a.txt', basePath: '/qinlong/dds/a.txt', name: 'a.txt', ext: 'txt' } })
    const noBase = mount(FilePreview, { props: { path: '/qinlong/dds/a.txt', name: 'a.txt', ext: 'txt' } })
    await flushPromises()

    expect(withExt.find('[data-testid="file-preview-ext-switch"]').exists()).toBe(false)
    expect(noBase.find('[data-testid="file-preview-ext-switch"]').exists()).toBe(false)
  })

  it('切到 HTML：先探一次确认快照在，再把 iframe 指到 .html', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('正文'))
    const head = vi.spyOn(ossFile, 'fetchOssFileHead').mockResolvedValue(bufOf('<html>'))
    const wrapper = mount(FilePreview, { props: { path: `${BASE}.txt`, basePath: BASE, name: '3e19f177….txt', ext: 'txt' } })
    await flushPromises()

    await wrapper.get('[data-testid="file-preview-ext-html"]').trigger('click')
    await flushPromises()

    // 探测打在 .html 上（html 走 iframe 直连跨源，加载失败前端收不到信号，所以必须先探）
    expect(head.mock.calls.some(([p]) => p === `${BASE}.html`)).toBe(true)
    expect(wrapper.get('[data-testid="file-preview-html"]').attributes('src')).toContain(`fileId=${BASE}.html`)
    expect(wrapper.get('[data-testid="file-preview-ext-html"]').classes()).toContain('on')
  })

  it('这条没有 HTML 快照（探测 404）：就地提示并留在 TXT，不给白框', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('正文'))
    vi.spyOn(ossFile, 'fetchOssFileHead').mockRejectedValue(new Error('取文件失败（HTTP 404）'))
    const wrapper = mount(FilePreview, { props: { path: `${BASE}.txt`, basePath: BASE, name: '3e19f177….txt', ext: 'txt' } })
    await flushPromises()

    await wrapper.get('[data-testid="file-preview-ext-html"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="file-preview-ext-note"]').text()).toBe('这条没有 HTML 快照')
    expect(wrapper.get('[data-testid="file-preview-ext-txt"]').classes()).toContain('on')
    expect(wrapper.find('[data-testid="file-preview-html"]').exists()).toBe(false)
  })

  it('下载与新窗口打开跟着切：切到 HTML 后文件名不能还是 .txt', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('正文'))
    vi.spyOn(ossFile, 'fetchOssFileHead').mockResolvedValue(bufOf('<html>'))
    const wrapper = mount(FilePreview, { props: { path: `${BASE}.txt`, basePath: BASE, name: '3e19f177f3db886a6b11384594d8721e.txt', ext: 'txt' } })
    await flushPromises()

    await wrapper.get('[data-testid="file-preview-ext-html"]').trigger('click')
    await flushPromises()

    const download = wrapper.get('[data-testid="file-preview-download"]')
    expect(download.attributes('href')).toContain(`fileId=${BASE}.html`)
    expect(download.attributes('download')).toBe('3e19f177f3db886a6b11384594d8721e.html')
    expect(wrapper.get('[data-testid="file-preview-open-window"]').attributes('href')).toContain(`${BASE}.html`)
  })

  it('换了一条数据：切换态清回默认，不跟着下一条走', async () => {
    vi.spyOn(ossFile, 'fetchOssFile').mockResolvedValue(bufOf('正文'))
    vi.spyOn(ossFile, 'fetchOssFileHead').mockResolvedValue(bufOf('<html>'))
    const wrapper = mount(FilePreview, { props: { path: `${BASE}.txt`, basePath: BASE, name: 'a.txt', ext: 'txt' } })
    await flushPromises()
    await wrapper.get('[data-testid="file-preview-ext-html"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="file-preview-ext-html"]').classes()).toContain('on')

    const next = '/gzh/gzh_msg/other/9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f'
    await wrapper.setProps({ path: `${next}.txt`, basePath: next, name: 'b.txt' })
    await flushPromises()

    expect(wrapper.get('[data-testid="file-preview-ext-txt"]').classes()).toContain('on')
    expect(wrapper.get('[data-testid="file-preview-download"]').attributes('href')).toContain(`fileId=${next}.txt`)
  })
})

