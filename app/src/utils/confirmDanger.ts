import { ElMessage, ElMessageBox } from 'element-plus'

/** 通用危险操作确认：弹确认框 → 执行 → 成功 toast；执行失败给可见的错误提示，不静默变成
 *  未捕获的 rejection——danger 端点在生产环境可能被写保护拦截（ProductionWriteBlockedError），
 *  这是真实会发生的失败路径，不是防御性假设。
 *  `onSuccess` 可选：默认行为是把 `res.message` 原样弹成功 toast，对大多数危险操作（删除、启停等）
 *  这就是全部结果。但个别接口的回执需要按内容判断成功/部分成功/失败（例如 `nextStep`，见
 *  `parseNextStepReceipt` 与 M3-0J），此时调用方传入 `onSuccess` 自行决定弹什么、弹哪种 toast。 */
export async function confirmDanger<T extends { message?: string } | undefined>(
  title: string,
  body: string,
  run: () => Promise<T>,
  onSuccess?: (res: T) => void,
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
    if (onSuccess) {
      onSuccess(res)
    } else {
      ElMessage.success(res?.message || '操作已提交（演示）')
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败，请重试')
  }
}
