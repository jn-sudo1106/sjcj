// 2026-10-14 用户报：OCR 节点卡片显示「运行」，右侧节点面板却显示「待配置」。
// 根因：卡片按配置算状态，面板直接显示种子里的占位 status。两边现在都走 nodeStatusOf。
import { describe, expect, it } from 'vitest'
import { NODE_CONFIGS, cloneConfig } from './flowModel'
import { nodeStatusOf } from './nodeStatus'

describe('nodeStatusOf', () => {
  it('配好的节点即使种子 status 还是「待配置」，也判为「运行」', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.status = '待配置'
    cfg.collectCfg!.url = 'https://example.com'
    cfg.collectCfg!.outputTable = '6200036'
    expect(nodeStatusOf(cfg).left).toBe('运行')
    expect(nodeStatusOf(cfg).missing).toEqual([])
  })

  it('缺 URL 时是「待配置」并说明缺什么', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.url = ''
    cfg.configUrl = ''
    cfg.collectCfg!.outputTable = '6200036'
    expect(nodeStatusOf(cfg)).toMatchObject({ left: '待配置', missing: ['URL'] })
  })

  it('停用节点是「已停止」', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.disabled = true
    expect(nodeStatusOf(cfg).left).toBe('已停止')
  })
})
