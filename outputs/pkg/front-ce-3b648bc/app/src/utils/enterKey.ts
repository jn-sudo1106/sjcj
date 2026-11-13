/**
 * 回车触发，但跳过中文输入法上屏时的 Enter。
 *
 * Vue 的 `@keyup.enter` 只看 key 是不是 Enter，不检查 `event.isComposing`——
 * 而中文输入法确认候选词时按的那个 Enter 同样会冒出 keyup。直接绑的后果是
 * 用户打字打到一半就把半截内容提交出去：搜索框最多多查一次，对话框会直接
 * 发出半截消息，查询条件则可能拼出错误的 SQL（2026-08-20 在生产实测复现：
 * 输入法上屏一次回车，表格立刻按半截条件「K1」重查，从 60 行变成 5 行）。
 *
 * 用法：`const onEnterSearch = withoutComposition(search)`，模板绑 `@keyup.enter="onEnterSearch"`。
 */
export function withoutComposition(handler: () => void) {
  return (event: KeyboardEvent) => {
    if (event.isComposing) return
    handler()
  }
}
