// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteScriptGeneratorDialog from './SiteScriptGeneratorDialog.vue'
import { generateSiteScript } from '@/api/siteScript'
import { runnerManagementApi } from '@/api/runnerManagement'

vi.mock('@/api/siteScript', () => ({ generateSiteScript: vi.fn() }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { scriptBinding: vi.fn(), publishScript: vi.fn(), adoptScript: vi.fn() } }))
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

it('发布候选版后保留旧绑定，只有采用动作才更新当前节点', async () => {
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: 'def scrape(url):\n    return []\n', warnings: [] })
  vi.mocked(runnerManagementApi.scriptBinding).mockResolvedValue({ configId: 'c-1', gitUrl: 'git/old.py', gitCommit: 'old', scriptDigest: 'sha256:old', publishedAt: '', status: 'published' })
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue({ gitUrl: 'git/new.py', gitCommit: 'new', scriptDigest: 'sha256:new' })
  vi.mocked(runnerManagementApi.adoptScript).mockResolvedValue({ configId: 'c-1', gitUrl: 'git/new.py', gitCommit: 'new', scriptDigest: 'sha256:new', publishedAt: '', status: 'published' })
  const wrapper = mount(SiteScriptGeneratorDialog, {
    props: { open: true, initialUrl: 'https://www.realcan.cn/newscenter', initialPrompt: '抓取新闻列表', configId: 'c-1' },
    global: { stubs: { ElDialog: { template: '<div><slot /></div>' }, ElButton: { template: '<button type="button"><slot /></button>' } } },
  })
  await flushPromises()
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="site-script-adopt"]').trigger('click')
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ configId: 'c-1', fileName: 'www.realcan.cn.py' }))
  expect(runnerManagementApi.adoptScript).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('git/old.py')
  await wrapper.get('[data-testid="site-script-bind"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.adoptScript).toHaveBeenCalledWith('c-1', 'sha256:new')
  expect(wrapper.text()).toContain('git/new.py')
})
