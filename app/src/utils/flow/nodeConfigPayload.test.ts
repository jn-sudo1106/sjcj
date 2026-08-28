import { describe, expect, it } from 'vitest'
import { applyConfigToNode, buildConfigPayload } from './nodeConfigPayload'
import { NODE_CONFIGS, cloneConfig } from '@/views/FlowCanvas/canvas/flowModel'
import type { Config } from '@/api'

function node() {
  const cfg = cloneConfig(NODE_CONFIGS['web-list'])
  cfg.title = '多彩贵州网-金融'
  if (cfg.collectCfg) cfg.collectCfg.url = 'http://finance.gog.cn/jrlc/index.shtml'
  cfg.collectCfg!.entryCondition = { mode: 'expr', logic: 'AND', items: [], expr: 'K6==nil' }
  return cfg
}

const config: Config = {
  configId: '1400765',
  name: 'python详情解析器_900',
  enabled: true,
  url: 'https://config-own-url.example/list',
  topic: 'dev_web_snatch_python_parse_new',
  entryTypeId: '900',
  inEntryTypeId: '900',
  multiMode: 2,
  templateCode: 'news',
  dedupType: 'ALL',
  codeRule: '{"globals":["列ID"]}',
  contentRule: '{"py_name":"zx_translate"}',
}

describe('节点 ↔ 配置字段映射', () => {
  it('applyConfigToNode 写配置字段，但不动节点名称 / 源 URL / 进入条件', () => {
    const cfg = node()
    applyConfigToNode(cfg, config)

    expect(cfg.configId).toBe('1400765')
    expect(cfg.configName).toBe('python详情解析器_900')
    expect(cfg.collectCfg?.multiMode).toBe(2)
    expect(cfg.collectCfg?.bizType).toBe('news')
    expect(cfg.collectCfg?.outputTable).toBe('900')
    expect(cfg.collectCfg?.inputTable).toBe('900')
    expect(cfg.collectCfg?.dedupMode).toBe('table')
    expect(cfg.collectCfg?.structuredConfig).toBe('{"globals":["列ID"]}')
    expect(cfg.collectCfg?.contentRules).toBe('{"py_name":"zx_translate"}')
    expect(cfg.taskCfg?.queue).toBe('dev_web_snatch_python_parse_new')

    // 节点名称与进入条件属流程、源 URL 属源：配置自己的 configUrl 都不能覆盖它们
    expect(cfg.title).toBe('多彩贵州网-金融')
    expect(cfg.collectCfg?.url).toBe('http://finance.gog.cn/jrlc/index.shtml')
    expect(cfg.collectCfg?.entryCondition?.expr).toBe('K6==nil')
  })

  it('buildConfigPayload 带上未建模的 BLOB 原值，不把它们清空', () => {
    const cfg = node()
    applyConfigToNode(cfg, config)
    const payload = buildConfigPayload(cfg, {
      configUrl: 'https://config-own-url.example/list',
      clearRule: '{"keep":1}',
      transRule: '{"t":2}',
      checkRule: '{"c":3}',
      snatchConf: '<xml/>',
    })

    expect(payload).toMatchObject({
      configName: 'python详情解析器_900',
      configUrl: 'https://config-own-url.example/list',
      entryTypeId: '900',
      inEntryType: '900',
      isMulti: 2,
      templetCode: 'news',
      topic: 'dev_web_snatch_python_parse_new',
      snatchDrepeat: 'ALL',
      clearRule: '{"keep":1}',
      transRule: '{"t":2}',
      checkRule: '{"c":3}',
      snatchConf: '<xml/>',
    })
    // 源 URL 不进配置：payload 里没有任何等于节点源 URL 的字段
    expect(Object.values(payload)).not.toContain('http://finance.gog.cn/jrlc/index.shtml')
  })

  it('源内去重回写成空串（旧 snatchDrepeat 口径）', () => {
    const cfg = node()
    applyConfigToNode(cfg, { ...config, dedupType: '' })
    expect(cfg.collectCfg?.dedupMode).toBe('source')
    expect(buildConfigPayload(cfg).snatchDrepeat).toBe('')
  })
})
