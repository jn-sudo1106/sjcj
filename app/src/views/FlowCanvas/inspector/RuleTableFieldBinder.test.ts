// @vitest-environment jsdom
// REVIEW-2026-08-04 P1 #3：搜索框快速连打字时旧请求真被 abort（不只是 requestSeq 防过期结果）。
// 单元测试只覆盖 RuleTableFieldBinder 的 runSearch abort 链路——API 层的 signal 透传
// 在 api/ruleHttp.test.ts 单独覆盖。
// 不使用 vi.useFakeTimers（debounce 用 setTimeout，与 fake timers 配合不稳），改用真实等待 + 直接调组件实例的 runSearch。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { ElMessage } from 'element-plus'
import RuleTableFieldBinder from './RuleTableFieldBinder.vue'
import { ruleApi, type RuleOrchestrationItem } from '@/api'
import type { RuleFieldOption, RuleOrchestration, RuleTableOption } from '@/api'

function mountBinder(modelValue: Partial<RuleOrchestration> = {}) {
  setActivePinia(createPinia())
  const fullModel = {
    dataSource: 'dp-wwdata',
    mode: 'new' as const,
    name: '',
    inputFields: [],
    outputFields: [],
    ...modelValue,
  }
  const ruleOptions: RuleOrchestrationItem[] = []
  const inputFieldOptions: RuleFieldOption[] = []
  const outputFieldOptions: RuleFieldOption[] = []
  const wrapper = mount(RuleTableFieldBinder, {
    global: { plugins: [ElementPlus] },
    props: {
      modelValue: fullModel,
      ruleOptions,
      inputFieldOptions,
      outputFieldOptions,
    },
  })
  return wrapper
}

afterEach(() => vi.restoreAllMocks())

describe('RuleTableFieldBinder · runSearch 取消旧请求（P1 #3）', () => {
  it('快速连打字：旧 search 的 controller 真正被 abort，fetch 收到 aborted signal', async () => {
    // 记录每次 call 拿到的 signal，外部主动 abort 时 signal.aborted 应为 true
    const capturedSignals: AbortSignal[] = []
    const resolvers: Array<(v: RuleTableOption[]) => void> = []
    const rejecters: Array<(e: unknown) => void> = []
    const pushPending = () => new Promise<RuleTableOption[]>((resolve, reject) => {
      resolvers.push(resolve)
      rejecters.push(reject)
    })
    vi.spyOn(ruleApi, 'orchestrationTableSearch').mockImplementation((_ds, _kw, signal) => {
      if (signal) capturedSignals.push(signal)
      return pushPending()
    })

    const wrapper = mountBinder()
    await flushPromises()

    // onInputTableFilter 是 el-select :remote-method 的 prop 函数，<script setup> 自动暴露
    // 在 wrapper.vm 上；调它能直接触发 debouncedSearch，不依赖 el-select 内部行为。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any
    expect(typeof vm.onInputTableFilter).toBe('function')

    // 第一次输入：触发 debouncedSearch（300ms 防抖）
    vm.onInputTableFilter('em')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()
    expect(capturedSignals.length).toBe(1)
    const firstSignal = capturedSignals[0]
    expect(firstSignal.aborted).toBe(false)

    // 第二次输入：debouncedSearch 再次触发，runSearch 内部应主动 abort 旧 controller
    vm.onInputTableFilter('ema')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()
    expect(capturedSignals.length).toBe(2)
    expect(firstSignal.aborted).toBe(true) // 旧 request 的 signal 真的被 abort
    const secondSignal = capturedSignals[1]
    expect(secondSignal.aborted).toBe(false)

    // 收尾：让两个 promise 都收掉不留 pending
    resolvers[0]?.([])
    rejecters[1]?.(new DOMException('aborted', 'AbortError'))
    await flushPromises()
  })

  it('AbortError 不弹 ElMessage.error：主动取消是预期行为，不是错误', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: () => {} }))
    let firstSignal: AbortSignal | undefined
    vi.spyOn(ruleApi, 'orchestrationTableSearch').mockImplementation((_ds, _kw, signal) => {
      if (signal && !firstSignal) firstSignal = signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })
    })

    const wrapper = mountBinder()
    await flushPromises()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vm = wrapper.vm as any

    // 第一次输入
    vm.onInputTableFilter('em')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()
    expect(firstSignal?.aborted).toBe(false)

    // 触发新一轮：旧 controller abort → 旧 fetch 抛 AbortError
    vm.onInputTableFilter('ema')
    await new Promise((r) => setTimeout(r, 320))
    await flushPromises()

    // AbortError 触发期间没有 ElMessage.error 被调用
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

