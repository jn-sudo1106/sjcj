// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ElMessage } from 'element-plus'
import { copyToClipboard } from './clipboard'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
  ElMessageBox: { alert: vi.fn() },
}))

describe('clipboard · copyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('空文本直接返回 false，不调用任何 API', async () => {
    const res = await copyToClipboard('')
    expect(res).toBe(false)
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('navigator.clipboard.writeText 成功时调用成功提示', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const res = await copyToClipboard('test-value', 'ENTRY_ID')
    expect(res).toBe(true)
    expect(writeText).toHaveBeenCalledWith('test-value')
    expect(ElMessage.success).toHaveBeenCalledWith('已复制 ENTRY_ID')
  })

  it('navigator.clipboard 失败时降级到 execCommand', async () => {
    Object.assign(navigator, { clipboard: undefined })
    document.execCommand = vi.fn().mockReturnValue(true)
    const res = await copyToClipboard('fallback-val')
    expect(res).toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(ElMessage.success).toHaveBeenCalledWith('已复制')
  })
})
