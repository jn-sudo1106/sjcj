import { ElMessage, ElMessageBox } from 'element-plus'

/** 通用危险操作确认：弹确认框 → 执行 → 成功 toast；执行失败给可见的错误提示，不静默变成
 *  未捕获的 rejection——danger 端点在生产环境可能被写保护拦截（ProductionWriteBlockedError），
 *  这是真实会发生的失败路径，不是防御性假设。 */
export async function confirmDanger(
  title: string,
  body: string,
  run: () => Promise<{ message?: string }>,
) {
  try {
    await ElMessageBox.confirm(body, title, {
      type: 'warning',
      confirmButtonText: '确认执行',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    const res = await run()
    ElMessage.success(res?.message || '操作已提交（演示）')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败，请重试')
  }
}
