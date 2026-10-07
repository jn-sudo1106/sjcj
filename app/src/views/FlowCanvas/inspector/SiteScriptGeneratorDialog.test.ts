// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SiteScriptGeneratorDialog from './SiteScriptGeneratorDialog.vue'
import { generateSiteScript } from '@/api/siteScript'
import { runnerManagementApi } from '@/api/runnerManagement'

vi.mock('@/api/siteScript', () => ({ generateSiteScript: vi.fn() }))
vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: {
  scriptBinding: vi.fn(), publishScript: vi.fn(), adoptScript: vi.fn(),
  siteCodeVersions: vi.fn(), siteCodeBindings: vi.fn(), bindSiteCode: vi.fn(),
} }))
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

it('重新打开时使用最新列表 URL', async () => {
  const wrapper = mount(SiteScriptGeneratorDialog, {
    props: { open: true, initialUrl: 'https://old.example.com/list', initialPrompt: '' },
    global: { stubs: { ElDialog: { template: '<div><slot /></div>' }, ElButton: { template: '<button type="button"><slot /></button>' } } },
  })
  await wrapper.setProps({ open: false, initialUrl: 'https://new.example.com/list' })
  await wrapper.setProps({ open: true })
  expect((wrapper.get('[data-testid="site-script-url"]').element as HTMLInputElement).value).toBe('https://new.example.com/list')
})

it('列表 URL 改变时清除旧地址生成的代码', async () => {
  const wrapper = mount(SiteScriptGeneratorDialog, {
    props: { open: true, initialUrl: 'https://old.example.com/list', initialPrompt: '' },
    global: { stubs: { ElDialog: { template: '<div><slot /></div>' }, ElButton: { template: '<button type="button"><slot /></button>' } } },
  })
  await wrapper.get('[data-testid="site-script-manual"]').trigger('click')
  expect(wrapper.find('[data-testid="site-script-editor"]').exists()).toBe(true)
  await wrapper.setProps({ initialUrl: 'https://new.example.com/list' })
  expect((wrapper.get('[data-testid="site-script-url"]').element as HTMLInputElement).value).toBe('https://new.example.com/list')
  expect(wrapper.find('[data-testid="site-script-editor"]').exists()).toBe(false)
})

it('保存代码版本时不选择测试或生产环境，并带上节点抓取类型以便分仓库', async () => {
  vi.mocked(generateSiteScript).mockResolvedValue({ fileName: 'www.realcan.cn.py', code: 'def scrape(url):\n    return []\n', warnings: [] })
  const oldVersion = { codeId: 'code-1', configId: 'c-1', queueName: 'news_list', siteHost: 'www.realcan.cn', storagePath: 'code/c-1/code-1.py', deliveryPath: 'sites/www.realcan.cn.py', gitUrl: 'git/old.py', gitCommit: 'old', scriptDigest: 'sha256:old', publishedAt: '', prompt: '', url: '', environment: 'test' as const, repoId: 'repo-web', repoName: '网页抓取代码' }
  const newVersion = { ...oldVersion, gitUrl: 'git/new.py', gitCommit: 'new', scriptDigest: 'sha256:new' }
  vi.mocked(runnerManagementApi.siteCodeVersions).mockResolvedValue([oldVersion])
  vi.mocked(runnerManagementApi.publishScript).mockResolvedValue(newVersion)
  const wrapper = mount(SiteScriptGeneratorDialog, {
    props: { open: true, initialUrl: 'https://www.realcan.cn/newscenter', initialPrompt: '抓取新闻列表', configId: 'c-1', queueName: 'news_list', configType: '90' },
    global: { stubs: { ElDialog: { template: '<div><slot /></div>' }, ElButton: { template: '<button type="button"><slot /></button>' } } },
  })
  await flushPromises()
  expect(wrapper.get('[data-testid="site-script-repo"]').text()).toBe('代码仓库：网页抓取代码')
  await wrapper.get('[data-testid="site-script-generate"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="site-script-adopt"]').trigger('click')
  await wrapper.get('[data-testid="site-script-publish"]').trigger('click')
  await flushPromises()
  expect(runnerManagementApi.publishScript).toHaveBeenCalledWith(expect.objectContaining({ configId: 'c-1', queueName: 'news_list', codeType: 'site', siteHost: 'www.realcan.cn', configType: '90' }))
  expect(runnerManagementApi.bindSiteCode).not.toHaveBeenCalled()
  expect(wrapper.find('[data-testid="site-script-bind"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('运行环境')
  expect(wrapper.text()).toContain('sha256:new')
  expect(wrapper.text()).toContain('已保存到「网页抓取代码」')
})
