// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteScriptGeneratorDialog from './SiteScriptGeneratorDialog.vue'
import { generateSiteScript } from '@/api/siteScript'

vi.mock('@/api/siteScript', () => ({ generateSiteScript: vi.fn() }))
afterEach(() => vi.resetAllMocks())

it('previews a generated script and keeps edited code until a new result is adopted', async () => {
  const generate = vi.mocked(generateSiteScript)
  generate
    .mockResolvedValueOnce({ fileName: 'www.realcan.cn.py', code: 'def scrape(url):\n    return []\n', warnings: [] })
    .mockResolvedValueOnce({ fileName: 'www.realcan.cn.py', code: 'def scrape(url):\n    return [1]\n', warnings: [] })
  const wrapper = mount(SiteScriptGeneratorDialog, {
    props: { open: false, initialUrl: 'https://www.realcan.cn/newscenter', initialPrompt: '抓取新闻列表' },
    global: {
      stubs: {
        ElDialog: { props: ['modelValue'], template: '<div><slot /></div>' },
        ElButton: { template: '<button type="button"><slot /></button>' },
      },
    },
  })
  await wrapper.setProps({ open: true })
  expect((wrapper.find('[data-testid="site-script-url"]').element as HTMLInputElement).value).toBe('https://www.realcan.cn/newscenter')
  await wrapper.find('[data-testid="site-script-generate"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-testid="site-script-candidate"]').exists()).toBe(true)
  expect(wrapper.find('[data-testid="site-script-editor"]').exists()).toBe(false)
  await wrapper.find('[data-testid="site-script-adopt"]').trigger('click')
  const editor = wrapper.find('[aria-label="可编辑 Python 代码"]')
  await editor.setValue('def scrape(url):\n    return ["edited"]\n')
  await wrapper.find('[data-testid="site-script-generate"]').trigger('click')
  await flushPromises()
  expect((wrapper.find('[aria-label="可编辑 Python 代码"]').element as HTMLTextAreaElement).value).toContain('edited')
  expect((wrapper.find('[aria-label="生成结果预览"]').element as HTMLTextAreaElement).value).toContain('return [1]')
  expect(generate).toHaveBeenCalledWith({
    prompt: '抓取新闻列表',
    url: 'https://www.realcan.cn/newscenter',
    sampleId: 'www.realcan.cn.py',
  }, expect.any(AbortSignal))
  wrapper.unmount()
})
