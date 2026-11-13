// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { sourceApi } from '@/api'
import SnatchLauncher from './SnatchLauncher.vue'

afterEach(() => vi.restoreAllMocks())

describe('SnatchLauncher · 指定当前流程', () => {
  it.each([undefined, '21000040'])('无参数直发透传流程 %s，未指定时仍走默认流程', async (flowId) => {
    vi.spyOn(sourceApi, 'loadParams').mockResolvedValue({})
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true })
    const wrapper = mount(SnatchLauncher, { global: { stubs: { SourceParamModal: true } } })
    try {
      await wrapper.vm.launch('430024910', { flowId })
      expect(send).toHaveBeenCalledWith({
        ids: ['430024910'], param: {}, all: 0, include: [], skip: 0, queue: undefined, flowId,
      })
    } finally { wrapper.unmount() }
  })

  it('有参数时弹窗确认仍发送所选辅助流程、参数和队列', async () => {
    vi.spyOn(sourceApi, 'loadParams').mockResolvedValue({ '1401218': [{ paramId: '150', paramName: '日期' }] })
    const send = vi.spyOn(sourceApi, 'sendSnatchWithParam').mockResolvedValue({ ok: true })
    const showParam = vi.fn()
    const wrapper = mount(SnatchLauncher, { global: { stubs: {
      SourceParamModal: { name: 'SourceParamModal', props: ['callback', 'suppressOwnSuccessToast'], setup(_, { expose }) { expose({ showParam }) }, template: '<div />' },
    } } })
    const onSuccess = vi.fn()
    try {
      await wrapper.vm.launch('430024910', { flowId: '21000040', configId: '1401218', onSuccess })
      expect(showParam).toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
      const callback = wrapper.getComponent({ name: 'SourceParamModal' }).props('callback')
      await callback(['430024910'], { '1401218_150': '20261102' }, 0, ['150'], 1, 'test_queue')
      expect(send).toHaveBeenCalledWith({
        ids: ['430024910'], param: { '1401218_150': '20261102' }, all: 0, include: ['150'], skip: 1,
        queue: 'test_queue', flowId: '21000040',
      })
      expect(onSuccess).toHaveBeenCalledOnce()
    } finally { wrapper.unmount() }
  })
})
