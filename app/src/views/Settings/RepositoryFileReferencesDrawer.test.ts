// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import { runnerManagementApi as api, type RepositoryFileReferences } from '@/api/runnerManagement'
import RepositoryFileReferencesDrawer from './RepositoryFileReferencesDrawer.vue'

const response: RepositoryFileReferences = { repoId: 'repo', repoName: '默认仓库', path: '下载/client.py', protectionReasons: ['流程节点代码引用'], items: [
  { kind: 'deployment', scope: 'current', configId: '101', queueName: 'download', name: '下载部署', deploymentId: 'deployment1', targetPaths: ['app/client.py'],
    sourceNodes: [{ configId: '101', flowId: '11', flowName: '下载流程', stepId: '22', nodeName: '下载节点' }] },
  { kind: 'version', scope: 'history', configId: '101', queueName: 'download', digest: 'sha256:old', isLatest: false, sourceNodes: [] },
] }
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => { vi.spyOn(api, 'codeRepositoryFileReferences').mockResolvedValue(structuredClone(response)) })
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); document.body.innerHTML = '' })
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
  await router.push('/settings'); await router.isReady()
  const w = mount(RepositoryFileReferencesDrawer, { attachTo: document.body, global: { plugins: [ElementPlus, router], stubs: { ConfigTemplateDrawer: true } } })
  wrappers.push(w); w.vm.open('repo', response.path); await flushPromises(); return w
}
it('显示流程、配置、部署跳转，并可单独筛选历史引用', async () => {
  await setup()
  expect(api.codeRepositoryFileReferences).toHaveBeenCalledWith('repo', response.path)
  expect(document.body.textContent).toContain('下载流程'); expect(document.body.textContent).toContain('下载节点')
  expect(document.querySelector<HTMLAnchorElement>('[data-testid="reference-deployment-link"]')!.getAttribute('href')).toContain('deploymentId=deployment1')
  const history = [...document.querySelectorAll<HTMLButtonElement>('.rr-filters button')].find(button => button.textContent === '历史引用')!
  history.click(); await flushPromises()
  expect(document.querySelectorAll('[data-testid="repository-reference"]')).toHaveLength(1)
  expect(document.querySelector('.rr-list')!.textContent).toContain('sha256:old')
})
it('查询失败保留文件信息并支持刷新', async () => {
  vi.mocked(api.codeRepositoryFileReferences).mockRejectedValueOnce(new Error('查询不可用'))
  await setup()
  expect(document.body.textContent).toContain('查询不可用')
  const refresh = [...document.querySelectorAll<HTMLButtonElement>('.rr-heading button')].find(button => button.textContent === '刷新')!
  refresh.click(); await flushPromises()
  expect(document.body.textContent).not.toContain('查询不可用')
  expect(document.body.textContent).toContain('下载部署')
})
it('按文件对应的代码与队列取消关联，刷新后成为历史记录并通知仓库列表', async () => {
  const item = { kind: 'node' as const, scope: 'current' as const, configId: '1400654', codeId: '8d1c', queueName: 'dev_web_snatch_5891_sourcecode', digest: 'sha256:current', sourceNodes: [] }
  vi.mocked(api.codeRepositoryFileReferences).mockResolvedValueOnce({ ...response, items: [item] }).mockResolvedValue({ ...response, protectionReasons: [], items: [{ ...item, scope: 'history' }] })
  const change = vi.spyOn(api, 'changeScriptFileAssociation').mockResolvedValue({ ok: true, message: '已取消关联' })
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
  const w = await setup(); await w.setProps({ canWrite: true })
  document.querySelector<HTMLButtonElement>('[data-testid="reference-unlink-node"]')!.click(); await flushPromises()
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('dev_web_snatch_5891_sourcecode'), '取消对应代码关联', expect.anything())
  expect(change).toHaveBeenCalledWith({ digest: item.digest, configId: item.configId, queueName: item.queueName, target: 'saved', action: 'unlink' })
  expect(w.emitted('changed')).toHaveLength(1)
  expect(document.querySelector('[data-testid="reference-unlink-node"]')).toBeNull()
})
