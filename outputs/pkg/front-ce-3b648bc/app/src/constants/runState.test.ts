import { describe, expect, it } from 'vitest'
import { dataStateInfo, runStateInfo, sourceRunStateInfo } from './runState'

describe('runState 状态字典', () => {
  it('运行状态已知码转中文，悬浮说明带原码', () => {
    expect(runStateInfo('L')).toMatchObject({ label: '运行中', known: true })
    expect(runStateInfo('C')).toMatchObject({ label: '完成', known: true })
    expect(runStateInfo('E')).toMatchObject({ label: '异常', known: true })
    expect(runStateInfo('D')).toMatchObject({ label: '已停用', known: true })
    expect(runStateInfo('W1').label).toBe('排队')
    expect(runStateInfo('E').hint).toContain('（E）')
  })

  it('未知码原样显示并提示「未知状态」', () => {
    expect(runStateInfo('ZZ')).toEqual({ code: 'ZZ', label: 'ZZ', hint: '未知状态：ZZ', known: false })
    expect(dataStateInfo('X1')).toMatchObject({ label: 'X1', hint: '未知状态：X1', known: false })
  })

  it('空值用调用方给的占位', () => {
    expect(runStateInfo(undefined).label).toBe('—')
    expect(runStateInfo('', '暂无运行记录').label).toBe('暂无运行记录')
    expect(runStateInfo(null).known).toBe(true)
  })

  it('源状态叫法跟源管理一致（C=正常），数据状态 C=初始，同一个码不混用', () => {
    expect(sourceRunStateInfo('C').label).toBe('正常')
    expect(sourceRunStateInfo('L').label).toBe('运行中')
    expect(dataStateInfo('C').label).toBe('初始')
    expect(dataStateInfo('NF').label).toBe('404')
  })
})
