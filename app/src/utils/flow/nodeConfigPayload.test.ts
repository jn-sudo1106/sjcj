import { describe, expect, it } from 'vitest'
import { applyConfigToNode, buildConfigPayload } from './nodeConfigPayload'
import { NODE_CONFIGS, cloneConfig, makeDefaultExecConfig, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
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
  runPolicy: '{"snatch":{"retryCnt":3}}',
}

describe('节点 ↔ 配置字段映射', () => {
  it('applyConfigToNode 写配置字段，但不动节点名称 / 源 URL / 进入条件', () => {
    const cfg = node()
    applyConfigToNode(cfg, config)

    expect(cfg.configId).toBe('1400765')
    expect(cfg.configName).toBe('python详情解析器_900')
    expect(cfg.configUrl).toBe('https://config-own-url.example/list')
    expect(cfg.collectCfg?.multiMode).toBe(2)
    expect(cfg.collectCfg?.bizType).toBe('news')
    expect(cfg.collectCfg?.outputTable).toBe('900')
    expect(cfg.collectCfg?.inputTable).toBe('900')
    expect(cfg.collectCfg?.dedupMode).toBe('table')
    expect(cfg.collectCfg?.structuredConfig).toBe('{"globals":["列ID"]}')
    expect(cfg.collectCfg?.contentRules).toBe('{"py_name":"zx_translate"}')
    expect(cfg.taskCfg?.queue).toBe('dev_web_snatch_python_parse_new')
    expect(cfg.runPolicy).toBe('{"snatch":{"retryCnt":3}}')

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
      runPolicy: '{"snatch":{"retryCnt":5}}',
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
      runPolicy: '{"snatch":{"retryCnt":5}}',
    })
    // 源 URL 不进配置：payload 里没有任何等于节点源 URL 的字段
    expect(Object.values(payload)).not.toContain('http://finance.gog.cn/jrlc/index.shtml')
  })

  it('节点上改过配置 URL 时写入 payload，仍不用源 URL', () => {
    const cfg = node()
    applyConfigToNode(cfg, config)
    cfg.configUrl = 'https://edited-config-url.example/'
    const payload = buildConfigPayload(cfg, { configUrl: 'https://config-own-url.example/list' })
    expect(payload.configUrl).toBe('https://edited-config-url.example/')
    expect(Object.values(payload)).not.toContain('http://finance.gog.cn/jrlc/index.shtml')
  })

  it('节点没回填配置 URL 时保持后端原值', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    expect(cfg.configUrl).toBeUndefined()
    const payload = buildConfigPayload(cfg, { configUrl: 'https://passport.baidu.com/' })
    expect(payload.configUrl).toBe('https://passport.baidu.com/')
  })

  it('源内去重回写成空串（旧 snatchDrepeat 口径）', () => {
    const cfg = node()
    applyConfigToNode(cfg, { ...config, dedupType: '' })
    expect(cfg.collectCfg?.dedupMode).toBe('source')
    expect(buildConfigPayload(cfg).snatchDrepeat).toBe('')
  })
})

describe('buildConfigPayload 不覆盖节点上没有的字段（2026-08-28 回归）', () => {
  // 实测：配置 1400968 的 templetCode='login' 曾被"保存配置"写空，登录节点模板路由随之失效。
  // 根因是节点上从没回填过这些配置正文字段，payload 却无条件把它们写进去。
  const base = {
    configId: '1400968',
    configName: 'baidu-登陆',
    configUrl: 'https://passport.baidu.com/',
    templetCode: 'login',
    snatchDrepeat: 'ALL',
    codeRule: '{"globals":["列ID"]}',
    contentRule: '{"py_name":"zx_translate"}',
    clearRule: '{"keep":1}',
    snatchConf: '<Actions/>',
    inEntryType: 900,
  }

  it('节点没回填业务类型 / 入库配置 / 正文规则时，保持后端原值不动', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.configName = 'baidu-登陆'
    // 刻意不设 bizType / structuredConfig / contentRules，模拟"没回填"
    const payload = buildConfigPayload(cfg, base)

    expect(payload.templetCode).toBe('login')
    expect(payload.codeRule).toBe('{"globals":["列ID"]}')
    expect(payload.contentRule).toBe('{"py_name":"zx_translate"}')
    // 未建模的 BLOB 一样原样带走
    expect(payload.clearRule).toBe('{"keep":1}')
    expect(payload.snatchConf).toBe('<Actions/>')
  })

  it('节点上有值时才覆盖', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.configName = 'baidu-登陆'
    cfg.collectCfg!.bizType = 'news'
    cfg.collectCfg!.structuredConfig = '{"changed":1}'
    const payload = buildConfigPayload(cfg, base)

    expect(payload.templetCode).toBe('news')
    expect(payload.codeRule).toBe('{"changed":1}')
    // 没改的仍是原值
    expect(payload.contentRule).toBe('{"py_name":"zx_translate"}')
  })

  it('节点上明确清空入库配置和正文规则时，以空字符串覆盖后端原值', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.configName = 'baidu-登陆'
    cfg.collectCfg!.structuredConfig = ''
    cfg.collectCfg!.contentRules = ''
    const payload = buildConfigPayload(cfg, base)

    expect(payload.codeRule).toBe('')
    expect(payload.contentRule).toBe('')
  })
})

describe('configType（节点类型 = 旧「抓取类型」，0828 W0-7）', () => {
  it('从节点的 snatchType 取出编号写进 payload', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.snatchType = '[140] - App抓取'
    expect(buildConfigPayload(cfg).configType).toBe(140)
  })

  it('解析不出编号就不写，保留 base 原值（不猜一个覆盖后端真值）', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.snatchType = '未知类型'
    expect(buildConfigPayload(cfg, { configType: 90 }).configType).toBe(90)
  })

  // 2026-09-07（Z6-3）：后端字典补上 600/700 后不再是"保留 base"，改成按模板写死。
  // 2026-09-17 订正编号：610 数据监控 / 620 数据校验（700 已另有其主——视频提取音频）。
  it('规则处理节点没有 snatchType，按结构信号（ruleCfg）写 600', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    expect(buildConfigPayload(cfg, { configType: 90 }).configType).toBe(600)
  })

  it('数据监控节点（template=monitor，同样复用 rule 种子）写 610，不是 600', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.template = 'monitor'
    // monitor 也带着 ruleCfg（复用同一颗种子）——必须让更具体的模板信号赢，
    // 否则两个信号都为真时永远落到 600，610 走不到。
    expect(buildConfigPayload(cfg, { configType: 90 }).configType).toBe(610)
  })

  it('数据校验节点（template=data-validation）写 620，不是 600', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.template = 'data-validation'
    expect(buildConfigPayload(cfg, { configType: 90 }).configType).toBe(620)
  })

  // 2026-09-18 防污染：规则式节点在 configDetail 回填前会被短暂画成规则节点（无 template、
  // 带 ruleCfg），这个窗口里点保存不能把 600 覆盖到配置的真实类型上（实测配置 1401011
  // 被写成 600，回读再也认不出是文章打标签）。base 里是无脚本节点类型号时保留 base。
  it.each([
    ['文章打标签', 730],
    ['翻译助手', 800],
    ['文章生成摘要', 720],
    ['音频提取文字', 710],
    ['视频提取音频', 700],
  ])('未识别回读节点 + base=%i：保留 base，不写 600（%s）', (name, baseType) => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.title = name
    delete (cfg as Partial<NodeConfig>).template
    expect(buildConfigPayload(cfg, { configType: baseType }).configType).toBe(baseType)
  })

  it('未识别回读节点 + base 是普通类型号（如 90）：照旧写 600 修复类型', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    delete (cfg as Partial<NodeConfig>).template
    expect(buildConfigPayload(cfg, { configType: 90 }).configType).toBe(600)
  })

  it('未识别回读节点 + base 为空：照旧写 600（历史规则配置补类型）', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    delete (cfg as Partial<NodeConfig>).template
    expect(buildConfigPayload(cfg, {}).configType).toBe(600)
  })

  // 2026-09-17：字典里其余类型各自成节点，落库编号跟随后端表。
  // 采集类按 snatchType 取（110/120/130/160/500），非采集类按模板表取（150/300/700/710/720）。
  it.each([
    ['excel-collect', 'excel', 110],
    ['doc-collect', 'doc', 120],
    ['pdf-collect', 'pdf', 130],
    ['mail-collect', 'mail-collect', 160],
    ['news-collect', 'news', 500],
    ['ocr', 'ocr', 150],
    ['check', 'check', 300],
    ['video-audio', 'video-audio', 700],
    ['audio-text', 'audio-text', 710],
    ['article-summary', 'article-summary', 720],
  ])('新类型节点 %s（template=%s）写 %i', (seedKey, template, expected) => {
    const cfg = cloneConfig(NODE_CONFIGS[seedKey])
    cfg.template = template
    expect(buildConfigPayload(cfg, { configType: 90 }).configType).toBe(expected)
  })
})

describe('isMulti 落库推导（2026-08-28：「更新父表」不由用户选）', () => {
  function detailNode(input: string, output: string) {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.multiMode = 0 // 界面上选的是「详情页」
    cfg.collectCfg!.inputTable = input
    cfg.collectCfg!.outputTable = output
    return cfg
  }

  it('详情页 + 输入表 == 输出表 → 落库 2（更新父表）', () => {
    expect(buildConfigPayload(detailNode('2103330', '2103330')).isMulti).toBe(2)
  })

  it('详情页 + 输入表 ≠ 输出表 → 落库 0（详情类）', () => {
    expect(buildConfigPayload(detailNode('2103330', '2103331')).isMulti).toBe(0)
  })

  it('输入表为空时不算成「相同」，落库 0', () => {
    expect(buildConfigPayload(detailNode('', '')).isMulti).toBe(0)
  })

  it('列表页恒为 1，不受输入/输出表影响', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.multiMode = 1
    cfg.collectCfg!.inputTable = '2103330'
    cfg.collectCfg!.outputTable = '2103330'
    expect(buildConfigPayload(cfg).isMulti).toBe(1)
  })

  // 「未设置」占位已按 D10 去掉，界面上永远显示一个具体值，所以落库也永远有值：
  // 模型上没值时按节点形态推导（web-list → 列表页 1，web-detail → 详情页 0），
  // 与界面回显共用 defaultMultiMode，保证"看到的就是会写进去的"。
  it('模型上没设过时按节点形态推导：列表节点 → 1', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    cfg.collectCfg!.multiMode = undefined
    expect(buildConfigPayload(cfg).isMulti).toBe(1)
  })

  it('模型上没设过时按节点形态推导：详情节点 + 输入≠输出 → 0', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-detail'])
    cfg.collectCfg!.multiMode = undefined
    cfg.collectCfg!.inputTable = '2101001'
    cfg.collectCfg!.outputTable = '2101002'
    expect(buildConfigPayload(cfg).isMulti).toBe(0)
  })

  it('非采集节点没有 collectCfg，不写这个字段，保留 base 原值', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    expect(buildConfigPayload(cfg, { isMulti: 2 }).isMulti).toBe(2)
  })
})

describe('prompt（2026-09-18：拼接后的系统提示词随配置保存落 cs_config.prompt）', () => {
  it('规则处理节点写 ruleCfg.systemPrompt（编排 Tab 拼接后的值）', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.ruleCfg!.systemPrompt = '拼接好的规则提示词：输入表 tb_a、输出表 tb_b'
    expect(buildConfigPayload(cfg).prompt).toBe('拼接好的规则提示词：输入表 tb_a、输出表 tb_b')
  })

  it('数据监控 / 数据校验节点（复用 rule 种子）同样取 ruleCfg', () => {
    for (const template of ['monitor', 'data-validation']) {
      const cfg = cloneConfig(NODE_CONFIGS['rule'])
      cfg.template = template
      cfg.ruleCfg!.systemPrompt = `拼接好的${template}提示词 source_id=430016398`
      expect(buildConfigPayload(cfg).prompt).toBe(`拼接好的${template}提示词 source_id=430016398`)
    }
  })

  it.each(['article-summary', 'article-tag', 'translate'])('%s 节点写 execCfg.systemPrompt', (seedKey) => {
    const cfg = cloneConfig(NODE_CONFIGS[seedKey])
    // 这几类节点插入时才建 execCfg，种子本身不带；模拟 Tab 拼接后写回的状态
    cfg.execCfg = { ...makeDefaultExecConfig(), systemPrompt: `${seedKey} 的提示词模板拼接结果` }
    expect(buildConfigPayload(cfg).prompt).toBe(`${seedKey} 的提示词模板拼接结果`)
  })

  it('普通采集节点不带 prompt：execCfg 里是抓取 XML 默认模板，不是系统提示词', () => {
    const cfg = cloneConfig(NODE_CONFIGS['web-list'])
    expect(buildConfigPayload(cfg, { prompt: 'base 原值' }).prompt).toBe('base 原值')
  })

  it('提示词为空 / 纯空白时不覆盖 base 原值（拼接尚未完成时不能抹掉后端真值）', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.ruleCfg!.systemPrompt = ''
    expect(buildConfigPayload(cfg, { prompt: 'base 原值' }).prompt).toBe('base 原值')
    cfg.ruleCfg!.systemPrompt = '   '
    expect(buildConfigPayload(cfg, { prompt: 'base 原值' }).prompt).toBe('base 原值')
  })
})

describe('codeRule（2026-09-20：翻译助手保存时把编排 Tab 的源/目标语言写进 code_rule）', () => {
  it('翻译助手节点默认带 {"from":"auto","to":"en"}（种子初始值）', () => {
    const cfg = cloneConfig(NODE_CONFIGS['translate'])
    expect(buildConfigPayload(cfg).codeRule).toBe('{"from":"auto","to":"en"}')
  })

  it('编排 Tab 改过语言后按节点上的结构化配置写 code_rule', () => {
    const cfg = cloneConfig(NODE_CONFIGS['translate'])
    cfg.structuredConfig = '{"from":"zh","to":"en"}'
    expect(buildConfigPayload(cfg).codeRule).toBe('{"from":"zh","to":"en"}')
  })

  it('非翻译助手节点不受影响：结构化配置照旧按节点值写', () => {
    const cfg = node()
    cfg.collectCfg!.structuredConfig = '{"globals":["列ID"]}'
    expect(buildConfigPayload(cfg).codeRule).toBe('{"globals":["列ID"]}')
  })
})

describe('coreParam（2026-09-20：打标签/摘要节点保存时把模型供应商与模型写进核心参数）', () => {
  it.each(['article-tag', 'article-summary'])('%s 节点写 {"providerCode","model"} 到 coreParam', (seedKey) => {
    const cfg = cloneConfig(NODE_CONFIGS[seedKey])
    cfg.execCfg = { ...makeDefaultExecConfig(), modelProviderCode: 'DeepSeek', modelCode: 'deepseek-v4-flash' }
    expect(buildConfigPayload(cfg).coreParam).toBe('{"providerCode":"DeepSeek","model":"deepseek-v4-flash"}')
  })

  it('模型没选全（只有供应商）时不写 coreParam，保留 base 原值', () => {
    const cfg = cloneConfig(NODE_CONFIGS['article-tag'])
    cfg.execCfg = { ...makeDefaultExecConfig(), modelProviderCode: 'DeepSeek' }
    expect(buildConfigPayload(cfg, { coreParam: 'base 原值' }).coreParam).toBe('base 原值')
  })

  it('节点回读到 coreParam 原值、模型没改时原样写回（不丢）', () => {
    const cfg = cloneConfig(NODE_CONFIGS['article-tag'])
    cfg.coreParam = '{"providerCode":"MiniMax","model":"abab6.5"}'
    expect(buildConfigPayload(cfg).coreParam).toBe('{"providerCode":"MiniMax","model":"abab6.5"}')
  })

  it('规则处理节点不受影响：coreParam 不写，code_rule 仍取结构化配置', () => {
    const cfg = cloneConfig(NODE_CONFIGS['rule'])
    cfg.structuredConfig = '{"globals":["列ID"]}'
    const payload = buildConfigPayload(cfg, { coreParam: 'base 原值' })
    expect(payload.codeRule).toBe('{"globals":["列ID"]}')
    expect(payload.coreParam).toBe('base 原值')
  })

  it('翻译助手节点不受影响：code_rule 仍写语言对，coreParam 不写', () => {
    const cfg = cloneConfig(NODE_CONFIGS['translate'])
    cfg.execCfg = { ...makeDefaultExecConfig(), modelProviderCode: 'DeepSeek', modelCode: 'deepseek-v4-flash' }
    const payload = buildConfigPayload(cfg)
    expect(payload.codeRule).toBe('{"from":"auto","to":"en"}')
    expect(payload.coreParam).toBeUndefined()
  })
})
