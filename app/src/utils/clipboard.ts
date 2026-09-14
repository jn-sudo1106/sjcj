import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 复制文本到剪贴板。
 * 兼容非 HTTPS / 非安全上下文（如局域网/内网 HTTP 部署），带有 textarea + execCommand 和弹窗兜底。
 */
export async function copyToClipboard(text: string, label?: string): Promise<boolean> {
  if (!text) return false
  const successMsg = label ? `已复制 ${label}` : '已复制'
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      ElMessage.success(successMsg)
      return true
    }
  } catch {
    // 降级到 execCommand
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (ok) {
      ElMessage.success(successMsg)
      return true
    }
  } catch {
    // 降级到弹窗
  }
  ElMessageBox.alert(text, '复制失败，请手动选中复制', { confirmButtonText: '知道了' })
  return false
}
