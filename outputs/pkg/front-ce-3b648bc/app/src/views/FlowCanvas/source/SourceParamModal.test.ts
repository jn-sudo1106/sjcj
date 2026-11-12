// @vitest-environment jsdom
// 带参发抓取弹窗提交（0901 生产实测报错修的真 bug）：
// 后端验证过 include 传 "configId_paramId" 拼接值（如 1400917_150）会报「参数格式错误」，
// 只认裸 paramId。跟 out[configId_paramId]=value 那份 body 参数是两套不同格式，别用同一种拼法。
// 旧平台 SourceParam.vue handleSubmit 就是这么分的：out 用拼接键，include.push(p.paramId) 用裸值。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElNotification } from 'element-plus'
import SourceParamModal from './SourceParamModal.vue'

function mountModal(suppressOwnSuccessToast?: boolean) {
  return mount(SourceParamModal, {
    props: { callback: vi.fn().mockResolvedValue({ message: 'ok' }), suppressOwnSuccessToast },
    global: { plugins: [ElementPlus] },
  })
}

async function submitParam(wrapper: ReturnType<typeof mountModal>) {
  const vm = wrapper.vm as unknown as { showParam: typeof SourceParamModal['showParam'] }
  vm.showParam(
    { 1400917: [{ paramId: '150', paramName: '当日日期', curValue: '20260901' }] },
    [{ sourceId: '430016398', name: 'test1' }],
    false,
  )
  await flushPromises()
  document.body.querySelector<HTMLButtonElement>('[data-testid="spm-submit"]')!.click()
  await flushPromises()
}

// el-dialog append-to-body 会把内容 teleport 到真实 document.body 且不随 wrapper 自动清理；
// 不在每个用例后 unmount 的话，下一个用例的 document.body.querySelector 会摸到上一个用例留下的按钮。
let wrapper: ReturnType<typeof mountModal> | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
})

describe('SourceParamModal · onSubmit include 参数格式', () => {
  it('include 只传裸 paramId，不拼 configId 前缀', async () => {
    wrapper = mountModal()
    await submitParam(wrapper)

    const callback = wrapper.props('callback') as ReturnType<typeof vi.fn>
    const [, param, , include] = callback.mock.calls[0]
    expect(include).toEqual(['150'])
    expect(param).toEqual({ '1400917_150': '20260901' })
  })
})

// 0901 生产实测反馈：从画布「发起抓取」走参数弹窗，发送成功弹了两条提示——弹窗自己发一条通用的
// 「发送成功…」，调用方（SnatchLauncher 的 opts.onSuccess）又发一条更具体的「已发起抓取 RUN-xxx」。
// suppressOwnSuccessToast 让调用方在自己会弹提示时，把弹窗这条通用提示让掉。
describe('SourceParamModal · suppressOwnSuccessToast', () => {
  it('未设置时（默认）：发送成功正常弹弹窗自己的提示', async () => {
    const successSpy = vi.spyOn(ElNotification, 'success')
    wrapper = mountModal()
    await submitParam(wrapper)
    expect(successSpy).toHaveBeenCalledTimes(1)
  })

  it('调用方设置 suppressOwnSuccessToast=true：弹窗不再重复弹自己那条提示', async () => {
    const successSpy = vi.spyOn(ElNotification, 'success')
    wrapper = mountModal(true)
    await submitParam(wrapper)
    expect(successSpy).not.toHaveBeenCalled()
  })
})
