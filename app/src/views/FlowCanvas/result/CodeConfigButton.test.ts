// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { sourceApi } from '@/api'
import CodeConfigButton from './CodeConfigButton.vue'
vi.mock('@/api', () => ({ sourceApi: { sendCodeConfig: vi.fn(), codeConfigOptions: vi.fn() }, flowCenterApi: { steps: vi.fn() } }))
afterEach(() => vi.resetAllMocks())
it('点击原操作旁的发代码只打开 MQ 表单，确认后才派发并保留点击时的目标', async () => {
  vi.mocked(sourceApi.codeConfigOptions).mockResolvedValue([{ configId: '900', name: '代码生成', topic: 'code-default', entryTypeId: 13 }])
  vi.mocked(sourceApi.sendCodeConfig).mockResolvedValue({ sourceId: '7', configId: '900', queue: 'manual', requestCnt: 1, sendCnt: 1, failCnt: 0, taskIds: ['1001'], tasks: [] })
  const ids = ['901']
  const w = mount(CodeConfigButton, { props: { buildTargets: () => [{ sourceId: '7', flowId: '50', entryTypeId: 11, entryIds: ids }] }, global: { plugins: [ElementPlus], stubs: { ElDrawer: { template: '<div><slot /></div>' } } } })
  await w.get('button').trigger('click'); await flushPromises()
  expect(sourceApi.sendCodeConfig).not.toHaveBeenCalled()
  ids.push('902')
  await w.get('[aria-label="派发队列"]').setValue('custom')
  await w.get('[aria-label="队列名称"]').setValue('manual')
  await w.findAll('button').find(button => button.text().includes('代码生成（'))!.trigger('click'); await flushPromises()
  expect(sourceApi.sendCodeConfig).toHaveBeenCalledWith({ sourceId: '7', flowId: '50', entryTypeId: 11, entryIds: ['901'], queue: 'manual' })
  expect(w.text()).toContain('1001')
  w.unmount()
})
