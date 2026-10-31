import { describe, expect, it, vi } from 'vitest'
import { confirmSharedFlowWrite, registerSharedFlowGuard, sharedFlowPending } from './sharedFlowGuard'

describe('sharedFlowGuard', () => {
  it('没有登记（不在源画布上）：不拦、直接放行', async () => {
    expect(sharedFlowPending()).toBe(false)
    expect(await confirmSharedFlowWrite('save')).toBe(true)
  })

  it('登记后：不需要确认时不弹窗；需要确认时把动作和带配置回调交给实现', async () => {
    let pending = false
    const ask = vi.fn().mockResolvedValue(false)
    const off = registerSharedFlowGuard({ pending: () => pending, ask })
    expect(await confirmSharedFlowWrite('save')).toBe(true)
    expect(ask).not.toHaveBeenCalled()

    pending = true
    const carry = vi.fn()
    expect(sharedFlowPending()).toBe(true)
    expect(await confirmSharedFlowWrite('publish', carry)).toBe(false)
    expect(ask).toHaveBeenCalledWith('publish', carry)
    off()
    expect(sharedFlowPending()).toBe(false)
  })

  it('注销只注销自己登记的那个', () => {
    const offA = registerSharedFlowGuard({ pending: () => true, ask: vi.fn() })
    const offB = registerSharedFlowGuard({ pending: () => true, ask: vi.fn() })
    offA()
    expect(sharedFlowPending()).toBe(true)
    offB()
    expect(sharedFlowPending()).toBe(false)
  })
})
