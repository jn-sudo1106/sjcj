// 同一配置的保存串行（updateConfig 并发校验不原子，186 实测）；不同配置互不等待；前一次失败不挡后一次
import { afterEach, describe, expect, it } from 'vitest'
import { enqueueConfigSave, flushNodeConfigs, registerNodeConfigFlusher, resetNodeConfigAutosave } from './nodeConfigAutosave'

afterEach(() => resetNodeConfigAutosave())

const defer = () => {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('nodeConfigAutosave', () => {
  it('同一 configId 串行，不同 configId 不互相等', async () => {
    const order: string[] = []
    const gate = defer()
    const first = enqueueConfigSave('1', async () => { order.push('1a-start'); await gate.promise; order.push('1a-end') })
    const second = enqueueConfigSave('1', async () => { order.push('1b') })
    const other = enqueueConfigSave('2', async () => { order.push('2') })
    await other
    expect(order).toEqual(['1a-start', '2'])
    gate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['1a-start', '2', '1a-end', '1b'])
  })

  it('前一次失败不挡后一次，失败原样抛给调用方', async () => {
    const failed = enqueueConfigSave('1', async () => { throw new Error('冲突') })
    const next = enqueueConfigSave('1', async () => 'ok')
    await expect(failed).rejects.toThrow('冲突')
    await expect(next).resolves.toBe('ok')
  })

  it('flushNodeConfigs 调登记的 flusher；注销只注销自己', async () => {
    const calls: string[] = []
    const off = registerNodeConfigFlusher(async () => { calls.push('a') })
    await flushNodeConfigs()
    registerNodeConfigFlusher(async () => { calls.push('b') })
    off()
    await flushNodeConfigs()
    expect(calls).toEqual(['a', 'b'])
  })
})
