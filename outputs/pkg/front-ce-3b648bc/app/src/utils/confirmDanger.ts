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
  return runAndReport(run, onSuccess)
}

/**
 * 按条件决定弹不弹（0917-05）。会上原话：「就不要弹框」「什么确认一下，不要确认」。
 *
 * **不是一律删**：这几个入口的后果规模差三个数量级——勾 3 条发后续和按当前条件发 5000 条
 * 是两件事，旧平台自己也是分档的。所以调用方把"要不要确认"算出来传进来，
 * 免确认那条路**成功 / 失败的处理与确认那条完全一致**（都走 runAndReport）——
 * 少弹一个框不等于少一层错误兜底，`danger` 端点在生产会被写保护拦截，那是真实路径。
 */
export async function confirmOrRun<T extends { message?: string } | undefined>(
  needConfirm: boolean,
  title: string,
  body: string,
  run: () => Promise<T>,
  onSuccess?: (res: T) => void,
) {
  if (needConfirm) return confirmDanger(title, body, run, onSuccess)
  return runAndReport(run, onSuccess)
}

/** 执行 + 回报。确认与免确认两条路共用，避免"免确认那条忘了处理失败"。 */
async function runAndReport<T extends { message?: string } | undefined>(
  run: () => Promise<T>,
  onSuccess?: (res: T) => void,
) {
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
