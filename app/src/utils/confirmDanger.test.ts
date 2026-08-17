import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmDanger } from './confirmDanger'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return {
    ...actual,
    ElMessage: { success: vi.fn(), error: vi.fn() },
    ElMessageBox: { confirm: vi.fn() },
  }
})

describe('confirmDanger', () => {
  beforeEach(() => {
    vi.mocked(ElMessage.success).mockClear()
    vi.mocked(ElMessage.error).mockClear()
    vi.mocked(ElMessageBox.confirm).mockReset()
  })

  it('取消确认框时不执行 run，不弹任何 toast', async () => {
    vi.mocked(ElMessageBox.confirm).mockRejectedValue('cancel')
    const run = vi.fn()

    await confirmDanger('标题', '正文', run)

    expect(run).not.toHaveBeenCalled()
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('确认后执行 run，成功时弹 run 返回的 message', async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const run = vi.fn().mockResolvedValue({ message: '已提交 3 条' })

    await confirmDanger('标题', '正文', run)

    expect(run).toHaveBeenCalled()
    expect(ElMessage.success).toHaveBeenCalledWith('已提交 3 条')
  })

  it('run 没返回 message 时用默认文案兜底', async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const run = vi.fn().mockResolvedValue({})

    await confirmDanger('标题', '正文', run)

    expect(ElMessage.success).toHaveBeenCalledWith('操作已提交（演示）')
  })

  it('run 抛错时给可见的错误提示，不是静默的未捕获 rejection（真实场景：生产写保护拦截）', async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const run = vi.fn().mockRejectedValue(new Error('生产环境写保护：端点不在允许清单'))

    await expect(confirmDanger('标题', '正文', run)).resolves.toBeUndefined()

    expect(ElMessage.error).toHaveBeenCalledWith('生产环境写保护：端点不在允许清单')
    expect(ElMessage.success).not.toHaveBeenCalled()
  })

  it('run 抛非 Error 值时用通用错误文案兜底', async () => {
    vi.mocked(ElMessageBox.confirm).mockResolvedValue('confirm' as never)
    const run = vi.fn().mockRejectedValue('boom')

    await confirmDanger('标题', '正文', run)

    expect(ElMessage.error).toHaveBeenCalledWith('操作失败，请重试')
  })
})
