// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ElMessage, ElMessageBox } from 'element-plus'
import { copyToClipboard } from './clipboard'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
  ElMessageBox: { alert: vi.fn(), confirm: vi.fn() },
}))

describe('clipboard · copyToClipboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('空文本：提示「没有可复制的内容」，不再静默什么都不做（0920-03）', async () => {
    const res = await copyToClipboard('', '源 ID')
    expect(res).toBe(false)
    expect(ElMessage.warning).toHaveBeenCalledWith('这里没有可复制的源 ID')
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

  // 部署站是 http（非安全上下文）：浏览器根本不暴露 navigator.clipboard，
  // 线上真正在跑的一直是这条同步兜底
  it('部署站形态（没有 navigator.clipboard）：直接走同步兜底并成功', async () => {
    Object.assign(navigator, { clipboard: undefined })
    document.execCommand = vi.fn().mockReturnValue(true)

    const res = await copyToClipboard('430017980', '源 ID')
    expect(res).toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(ElMessage.success).toHaveBeenCalledWith('已复制 源 ID')
  })

  // 页面没有焦点时 writeText 必抛 NotAllowedError（2026-09-21 生产实测），要能平滑降级
  it('writeText 抛 NotAllowedError（页面没焦点）：降级到同步兜底，不把错抛给调用方', async () => {
    const writeText = vi.fn().mockRejectedValue(Object.assign(new Error('Document is not focused.'), { name: 'NotAllowedError' }))
    Object.assign(navigator, { clipboard: { writeText } })
    document.execCommand = vi.fn().mockReturnValue(true)

    const res = await copyToClipboard('430017980')
    expect(res).toBe(true)
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('两条路都失败：弹出可一步复制的框（不是只能看的 alert）', async () => {
    Object.assign(navigator, { clipboard: undefined })
    document.execCommand = vi.fn().mockReturnValue(false)
    vi.mocked(ElMessageBox.confirm).mockRejectedValue(new Error('cancel'))

    const res = await copyToClipboard('430017980', '源 ID')
    expect(res).toBe(false)
    expect(ElMessageBox.alert).not.toHaveBeenCalled()
    const [, title, opts] = vi.mocked(ElMessageBox.confirm).mock.calls[0]
    expect(title).toBe('复制源 ID')
    expect(opts).toMatchObject({ confirmButtonText: '再试一次', cancelButtonText: '知道了' })
  })

  it('点「再试一次」= 一次新手势，这下成了就给成功提示', async () => {
    Object.assign(navigator, { clipboard: undefined })
    // 第一次失败（手势过期），弹框后再点一次成功
    document.execCommand = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as any)

    await copyToClipboard('430017980', '源 ID')
    await Promise.resolve()
    await Promise.resolve()

    expect(document.execCommand).toHaveBeenCalledTimes(2)
    expect(ElMessage.success).toHaveBeenCalledWith('已复制 源 ID')
  })

  it('复制完把焦点还回原来的元素，不要把人正在填的输入框顶掉', async () => {
    Object.assign(navigator, { clipboard: undefined })
    document.execCommand = vi.fn().mockReturnValue(true)
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    await copyToClipboard('430017980')
    expect(document.activeElement).toBe(input)
    input.remove()
  })
})
