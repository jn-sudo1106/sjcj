// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'
import { runnerManagementApi as api, type ModelInterface, type ModelInterfaceCall } from '@/api/runnerManagement'
import ModelInterfaceCallsDrawer from './ModelInterfaceCallsDrawer.vue'
const model = { id: 'agent-9222', name: 'Agent 9222', endpoint: 'http://host/agent', cdpPort: 9222 } as ModelInterface
const row: ModelInterfaceCall = { callId: 'call', interfaceId: model.id, interfaceName: model.name, kind: 'agent', model: 'hy3', endpoint: model.endpoint,
  cdpPort: 9222, serverId: '', serverAddress: '192.168.1.175', purpose: 'generation', status: 'succeeded', taskId: 'task', configId: '1401218', taskRecorded: true,
  startedAt: '2026-11-18T01:00:00Z', finishedAt: '2026-11-18T01:00:02Z', durationMs: 2000, httpStatus: 200, message: '' }
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks() })
async function setup() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }, { path: '/tasks', component: { template: '<div/>' } }] })
  await router.push('/')
  const w = mount(ModelInterfaceCallsDrawer, { props: { model }, global: { plugins: [ElementPlus, router], stubs: { ElDrawer: { props: ['title'], template: '<aside><slot /></aside>' } } } })
  wrappers.push(w); await flushPromises(); return w
}
it('按具体接口读取记录，展示机器、端口、耗时与任务跳转，刷新不调用模型', async () => {
  const calls = vi.spyOn(api, 'modelInterfaceCalls').mockResolvedValue({ interfaceId: model.id, items: [row], total: 1 })
  const w = await setup()
  expect(calls).toHaveBeenCalledWith(model.id, 1)
  for (const text of ['192.168.1.175', '9222 · hy3', '2.00 秒', '调用完成']) expect(w.text()).toContain(text)
  expect(w.get('a').attributes('href')).toContain('codeTaskId=task')
  await w.get('[aria-label="刷新调用记录"]').trigger('click'); await flushPromises()
  expect(calls).toHaveBeenCalledTimes(2)
  calls.mockRejectedValueOnce(new Error('接口不可达'))
  await w.get('[aria-label="刷新调用记录"]').trigger('click'); await flushPromises()
  expect(w.text()).toContain('接口不可达')
  expect(w.find('[data-testid="model-call-record"]').exists()).toBe(false)
})
it('切换接口后拒绝显示旧接口的响应，不混淆同机器的不同端口', async () => {
  vi.spyOn(api, 'modelInterfaceCalls').mockResolvedValue({ interfaceId: model.id, items: [row], total: 1 })
  const w = await setup()
  await w.setProps({ model: { ...model, id: 'agent-9223' } }); await flushPromises()
  expect(w.text()).toContain('调用记录与当前智能体不匹配')
  expect(w.find('[data-testid="model-call-record"]').exists()).toBe(false)
})
