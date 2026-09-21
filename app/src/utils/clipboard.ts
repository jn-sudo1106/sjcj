import { h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * 复制文本到剪贴板。
 *
 * **部署站是 http（非安全上下文），`navigator.clipboard` 根本不存在**，所以线上真正在跑的
 * 一直是下面那条 `execCommand` 兜底。2026-09-21 在生产环境实测出两条判据：
 *
 * | 条件 | `navigator.clipboard.writeText` | `execCommand('copy')` |
 * | --- | --- | --- |
 * | 有焦点 ＋ 刚点过 | ok | **true** |
 * | 有焦点，手势已过期（>5s） | ok | **false** |
 * | 没有焦点 | `NotAllowedError: Document is not focused` | **false** |
 *
 * 也就是说：异步 API 卡**焦点**，`execCommand` 卡**新鲜的用户手势**（Chrome 的 transient
 * activation，约 5 秒）。顺带排掉一个看着很像的嫌疑——**与 el-dialog 的 focus trap 无关**，
 * 弹窗开着照样能复制，只要手势是新鲜的；textarea 用 `opacity:0` 还是移到屏幕外也没有区别。
 *
 * 所以这里的顺序是有讲究的：**能确定异步 API 必然失败时就不去 await 它**，
 * 直接走同步那条——await 一次就多一分手势过期的风险，而兜底那条恰恰靠手势。
 */
export async function copyToClipboard(text: string, label?: string): Promise<boolean> {
  const successMsg = label ? `已复制 ${label}` : '已复制'
  if (!text) {
    // 原先是静默 return false：点了什么都不发生，比失败更让人摸不着头脑（0920-03）
    ElMessage.warning(label ? `这里没有可复制的${label}` : '没有可复制的内容')
    return false
  }

  // 部署站是 http，非安全上下文下浏览器压根不暴露 navigator.clipboard，这段整个跳过，
  // 线上走的一直是下面那条同步兜底。没焦点时这里会抛 NotAllowedError，照样落到兜底。
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      ElMessage.success(successMsg)
      return true
    } catch {
      // 落到下面的同步兜底
    }
  }

  if (execCommandCopy(text)) {
    ElMessage.success(successMsg)
    return true
  }

  void showManualCopy(text, label, successMsg)
  return false
}

/**
 * 同步兜底。**必须留在用户手势的同步执行栈里**，前面不要插 await。
 * 复制完把焦点还给原来的元素，否则用户正在填的输入框会失去焦点。
 */
function execCommandCopy(text: string): boolean {
  try {
    const restore = document.activeElement as HTMLElement | null
    const ta = document.createElement('textarea')
    ta.value = text
    ta.readOnly = true
    ta.setAttribute('aria-hidden', 'true')
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    ta.remove()
    restore?.focus?.()
    return ok
  } catch {
    return false
  }
}

/**
 * 自动复制失败时的最后一步。
 *
 * 原先是 `ElMessageBox.alert(text, '复制失败，请手动选中复制')`——只把值摆出来给人看，
 * 还得自己划选，等于把问题丢回给用户（0920-03 用户报的"灰色弹窗"就是它）。
 * 现在给两条出路：框里的输入框**打开就是全选的**（Ctrl+C 一步到位），
 * 以及一个「再试一次」——点它本身就是一次新的用户手势，而失败多半正是因为手势过期。
 */
async function showManualCopy(text: string, label: string | undefined, successMsg: string) {
  const message = h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
    h('span', { style: 'color:var(--rc-muted, #64748b);font-size:12px;line-height:1.6' },
      '浏览器没让这次复制生效（只允许在刚点击的那一下复制）。下面已经选好了，按 Ctrl+C / ⌘C 即可。'),
    h('input', {
      readonly: true,
      value: text,
      style: 'width:100%;height:30px;padding:0 8px;border:1px solid var(--rc-border, #dbe3ee);border-radius:6px;font-family:var(--rc-mono, monospace);font-size:12px',
      // 必须延后一拍：ElMessageBox 挂载后会把焦点移到自己的按钮上，
      // 在 mounted 里直接 focus 会被它抢走——选区还在，但焦点不在输入框上，
      // Ctrl+C 一样复制不到（2026-09-21 实测）。
      onVnodeMounted: (vnode: { el: unknown }) => {
        const el = vnode.el as HTMLInputElement | null
        window.setTimeout(() => { el?.focus(); el?.select() }, 60)
      },
    }),
  ])
  try {
    await ElMessageBox.confirm(message, label ? `复制${label}` : '复制', {
      confirmButtonText: '再试一次',
      cancelButtonText: '知道了',
      closeOnClickModal: false,
    })
  } catch {
    return // 点了「知道了」/ 关闭
  }
  // 点「再试一次」= 一次新的用户手势，绝大多数情况下这下就成了
  if (execCommandCopy(text)) ElMessage.success(successMsg)
  else ElMessage.warning('还是没成功，请手动选中内容复制')
}
