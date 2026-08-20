import { describe, expect, it, vi } from 'vitest'
import { withoutComposition } from './enterKey'

describe('withoutComposition', () => {
  it('普通回车照常触发', () => {
    const fn = vi.fn()
    withoutComposition(fn)({ isComposing: false } as KeyboardEvent)
    expect(fn).toHaveBeenCalledOnce()
  })

  it('中文输入法上屏的回车不触发——Vue 的 @keyup.enter 不过滤 isComposing，直接绑会在打字打到一半时把半截内容提交出去', () => {
    const fn = vi.fn()
    withoutComposition(fn)({ isComposing: true } as KeyboardEvent)
    expect(fn).not.toHaveBeenCalled()
  })
})
