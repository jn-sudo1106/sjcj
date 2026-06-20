import { ref } from 'vue'
import { defineStore } from 'pinia'

// 模块级动作总线：业务页面注册「模块标题区」按钮的处理函数，AppShell 点击时派发。
// 未注册的动作触发即 no-op，保证各模块解耦、互不影响。
export const useUiStore = defineStore('ui', () => {
  const handlers = ref<Record<string, () => void>>({})

  function registerAction(key: string, fn: () => void) {
    handlers.value[key] = fn
  }
  function fireAction(key: string) {
    handlers.value[key]?.()
  }
  function clearActions() {
    handlers.value = {}
  }

  return { registerAction, fireAction, clearActions }
})
