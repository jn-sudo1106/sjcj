import { ElMessage, ElMessageBox } from 'element-plus'

/** 通用危险操作确认：弹确认框 → 执行 → 成功 toast */
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
  const res = await run()
  ElMessage.success(res?.message || '操作已提交（演示）')
}
