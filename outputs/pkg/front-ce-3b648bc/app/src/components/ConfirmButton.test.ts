// ConfirmButton 单元测试（P3-1 · plan §F.2 step 2）
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ElMessage, ElMessageBox } from 'element-plus'
import ConfirmButton from './ConfirmButton.vue'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  }
})

describe('ConfirmButton', () => {
  beforeEach(() => {
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.error).mockClear()
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  it('渲染按钮文字', () => {
    const wrapper = mount(ConfirmButton, {
      props: { text: '批量删除', action: () => ({ message: 'ok' }) },
    })
    expect(wrapper.text()).toContain('批量删除')
  })

  it('点击触发 ElMessageBox.confirm，confirm 后调 action', async () => {
    const action = vi.fn().mockResolvedValue({ message: '已删除 3 个源' })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)

    const wrapper = mount(ConfirmButton, {
      props: { text: '删除', type: 'danger', action },
    })
    // el-button 渲染后 DOM 是 <button class="el-button">，但 el-button 顶层 wrapper
    // 通过 wrapper.findComponent 或 .trigger('click') 触发（el-button 内部是 <button>）
    await wrapper.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(action).toHaveBeenCalledTimes(1)
    expect(ElMessage.success).toHaveBeenCalledWith('已删除 3 个源')
  })

  it('用户取消不调 action', async () => {
    const action = vi.fn().mockResolvedValue({ message: 'ok' })
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel' as never)

    const wrapper = mount(ConfirmButton, {
      props: { text: '删除', action },
    })
    await wrapper.trigger('click')
    await flushPromises()

    expect(action).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('action 抛错时显示 error toast', async () => {
    const action = vi.fn().mockRejectedValue(new Error('网络异常'))
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)

    const wrapper = mount(ConfirmButton, {
      props: { text: '删除', action },
    })
    await wrapper.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('网络异常')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('显式 successMessage 覆盖 action 返回的 message', async () => {
    const action = vi.fn().mockResolvedValue({ message: '原始消息' })
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)

    const wrapper = mount(ConfirmButton, {
      props: { text: '删除', action, successMessage: '覆盖消息' },
    })
    await wrapper.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(ElMessage.success).toHaveBeenCalledWith('覆盖消息')
  })
})
