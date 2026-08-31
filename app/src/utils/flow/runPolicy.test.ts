import { describe, expect, it } from 'vitest'
import { formatRunPolicyValue, parseRunPolicy } from './runPolicy'

describe('parseRunPolicy', () => {
  it('解析严格 JSON 的 snatch 策略', () => {
    expect(parseRunPolicy('{"snatch":{"retryCnt":3,"timeout":60,"toHost":true}}')).toEqual({
      state: 'parsed',
      values: { retryCnt: 3, timeout: 60, toHost: true },
    })
  })

  it('兼容旧平台的裸键名和单引号，但只保留九个白名单字段', () => {
    expect(parseRunPolicy("{snatch:{retryCnt:-1,perDomain:2,toHost:'0',unknown:99}}"))
      .toEqual({ state: 'parsed', values: { retryCnt: -1, perDomain: 2, toHost: '0' } })
  })

  it('空值和无法识别的表达式有明确状态，且不会执行代码', () => {
    expect(parseRunPolicy(null)).toEqual({ state: 'empty', values: {} })
    expect(parseRunPolicy('{snatch:(globalThis.compromised=true)}')).toEqual({ state: 'invalid', values: {} })
    expect((globalThis as { compromised?: boolean }).compromised).toBeUndefined()
  })
})

describe('formatRunPolicyValue', () => {
  it('格式化主机派发布尔值和缺值', () => {
    expect(formatRunPolicyValue('toHost', 1)).toBe('是')
    expect(formatRunPolicyValue('toHost', 'false')).toBe('否')
    expect(formatRunPolicyValue('timeout', undefined)).toBe('—')
  })
})
