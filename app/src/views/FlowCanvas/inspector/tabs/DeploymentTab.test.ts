// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useFlowStore } from '@/stores/flow'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { runnerManagementApi } from '@/api/runnerManagement'
import DeploymentTab from './DeploymentTab.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { generatedCodeState: vi.fn() } }))
afterEach(() => vi.resetAllMocks())
it('部署页仅加载当前源、真实流程和节点的归档，并将它传给多机器部署面板', async () => {
  setActivePinia(createPinia()); const flow = useFlowStore()
  flow.configs['41895'] = { ...cloneConfig(NODE_CONFIGS['web-list']), configId: '1401218', configType: '90' }
  flow.patchSource({ sourceId: '430024901', flowId: '21000040' }); flow.select('41895')
  vi.mocked(runnerManagementApi.generatedCodeState).mockResolvedValue({ autoCommit: true, archive: {
    archiveId: 'archive-current-source', status: 'committed', gitCommit: 'a'.repeat(40), files: [{ path: 'links/1401218/sites/example.com.py' }],
  } } as never)
  const wrapper = mount(DeploymentTab, { global: { stubs: { NodeDeploymentTargets: { props: ['archiveId'], template: '<div data-testid="targets">{{ archiveId }}<slot /></div>' }, ElButton: true } } })
  await flushPromises()
  expect(runnerManagementApi.generatedCodeState).toHaveBeenCalledWith('1401218', { sourceId: '430024901', flowId: '21000040', stepId: '41895' })
  expect(wrapper.get('[data-testid="targets"]').text()).toContain('archive-current-source')
  expect(wrapper.text()).toContain('links/1401218/sites/example.com.py')
  wrapper.unmount()
})
