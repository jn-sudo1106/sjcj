import { describe, expect, it } from 'vitest'
import { BIZ_TYPE_OPTIONS, MULTI_MODE_OPTIONS, WEB_TYPE_OPTIONS, SNATCH_TYPES, TEMPLATE_TO_SNATCH } from './flowModel'

// 这两个下拉的值直接写进旧平台的 config 表，必须与旧前端 column.config.js 逐字一致。
// 2026-08-28 事故：业务类型曾按会议口头举例编成 news/login/分类/公告——
// 「分类」「公告」后端不存在（选了写脏数据），而真实存在的 data（另类）不在列表里，
// 导致旧平台设成「另类」的配置在新平台 select 匹配不到 option、静默显示成空。
describe('旧平台枚举必须逐字一致', () => {
  it('业务类型 = 旧 templetCode（column.config.js:620）', () => {
    expect(BIZ_TYPE_OPTIONS).toEqual([
      { value: 'data', label: '另类' },
      { value: 'news', label: '新闻' },
      { value: 'login', label: '登陆' },
    ])
  })

  it('是否列表 = 旧 isMulti 三态（column.config.js:640）', () => {
    expect(MULTI_MODE_OPTIONS).toEqual([
      { value: 1, label: '列表类[根据去重字段去重]' },
      { value: 0, label: '详情类[根据父ID去重]' },
      { value: 2, label: '更新父表[根据父ID更新父表]' },
    ])
  })

  it('不含旧平台没有的臆造值', () => {
    const values = BIZ_TYPE_OPTIONS.map((o) => o.value)
    expect(values).not.toContain('category')
    expect(values).not.toContain('announcement')
  })
})

// 抓取类型（= 节点类型 = config.configType）。2026-08-28 生产实测 GET /v1/config/sourceTypes
// 当时全部 11 条；2026-09-07 补 600；**2026-09-17 用户给出后端表全量 17 条**（含 610 数据监控 /
// 620 数据校验，以及 700 视频提取音频 / 710 音频提取文字 / 720 文章生成摘要）。
// 那之后 700 不再表示数据监控——前端若还写 700/800，监控节点会存成"视频提取音频"、
// 校验节点会写一个字典里不存在的 800，所以编号一起订正了（见 nodeConfigPayload.configTypeFrom）。
// 2026-09-17 再订正一次：800 归「翻译助手」（读 sense_db.cfg_source_type 核对），
// 数据校验是 620 不变。
// 之前这里的硬编码含 95 / 155 / [BROWSER] / [WECHAT] / [LOGIN] 等后端不存在的值，
// 其中 95 会被 sourceTypeFromSnatchType 解析后写进新建源请求体——不是显示问题。
// 后来字典已新增 `95 = 文件下载`，所以 95 现在是真实值；155 / [BROWSER] / [WECHAT] / [LOGIN] 仍不是。
// **2026-10-25 用户给出后端全量 22 条**：PDF转MD 的真值是 802（911 不存在），另新增 801 网页抓取CS。
// 之后又新增 95=文件下载，当前快照按 22 条维护。
describe('抓取类型与后端字典一致（config/sourceTypes 实测）', () => {
  const REAL_SOURCE_TYPES = new Map<string, string>([
    ['90', '网页抓取'], ['95', '文件下载'], ['110', 'EXCEL抓取'], ['120', 'DOC抓取'], ['130', 'PDF抓取'],
    ['140', 'App抓取'], ['150', 'OCR抓取'], ['160', 'Mail抓取'], ['170', 'Python抓取'],
    ['300', '校验类'], ['400', '提取数据发邮件'], ['500', '资讯抓取'],
    ['600', '规则处理'], ['610', '数据监控'], ['620', '数据校验'],
    ['700', '视频提取音频'], ['710', '音频提取文字'], ['720', '文章生成摘要'], ['730', '文章打标签'],
    // 2026-09-17 用户在 cfg_source_type 里新增：800=翻译助手（此前 800 曾被本前端当作数据校验写出去，
    // 那个编号已经改成 620；回读时按节点名区分两者，见 buildNodeForStep）
    ['800', '翻译助手'],
    // 2026-10-25 用户给出后端 source_type 全量 22 条：新增 801 网页抓取CS；
    // PDF转MD 是 **802**，此前这里记的 911 后端根本不存在（写进 configType 就是脏数据）。
    ['801', '网页抓取CS'],
    ['802', 'PDF转MD'],
  ])

  it('SNATCH_TYPES 与字典逐条一致（编号 + 名称）', () => {
    const parsed = SNATCH_TYPES.map((t) => {
      const m = t.match(/^\[(\d+)\] - (.+)$/)
      expect(m, `「${t}」不是「[编号] - 名称」格式`).toBeTruthy()
      return [m![1], m![2]] as const
    })
    expect(parsed.length).toBe(REAL_SOURCE_TYPES.size)
    parsed.forEach(([code, name]) => {
      expect(REAL_SOURCE_TYPES.get(code), `编号 ${code} 不在后端字典里`).toBe(name)
    })
  })

  it('不含任何臆造值：155 / 911 / [BROWSER] / [WECHAT] / [LOGIN] 都不许再出现', () => {
    const all = [...SNATCH_TYPES, ...Object.values(TEMPLATE_TO_SNATCH)].join('|')
    expect(all).not.toContain('[155]')
    // 911 是 PDF转MD 曾经的错误编号（真值 802）；字典与模板映射里都不许再有它。
    expect(all).not.toContain('[911]')
    expect(all).not.toContain('[BROWSER]')
    expect(all).not.toContain('[WECHAT]')
    expect(all).not.toContain('[LOGIN]')
  })

  it('TEMPLATE_TO_SNATCH 的每个取值都出自 SNATCH_TYPES', () => {
    Object.entries(TEMPLATE_TO_SNATCH).forEach(([template, value]) => {
      expect(SNATCH_TYPES, `模板 ${template} 映射到了字典外的 ${value}`).toContain(value)
    })
  })
})

// 「网页类型」是展示层的说法（沿用新平台原有的列表页/详情页/文件附件页），落库仍是旧 isMulti。
// 展示可以不同名，但**底层取值和旧平台原文必须一一对应**，否则新旧逐字段核对就断了。
describe('网页类型 ↔ 旧 isMulti', () => {
  it('下拉只有列表页(1) / 详情页(0) 两项——「2 更新父表」不给用户选', () => {
    expect(WEB_TYPE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      [1, '列表页'],
      [0, '详情页'],
    ])
    expect(WEB_TYPE_OPTIONS.some((o) => o.value === 2)).toBe(false)
  })

  it('每项的 legacy 与旧平台原文逐字一致（核对时靠它对上旧平台）', () => {
    WEB_TYPE_OPTIONS.forEach((opt) => {
      const legacy = MULTI_MODE_OPTIONS.find((m) => m.value === opt.value)
      expect(legacy, `isMulti=${opt.value} 在旧平台清单里不存在`).toBeTruthy()
      expect(opt.legacy).toBe(legacy!.label)
    })
  })

  it('MULTI_MODE_OPTIONS 保留完整三态——它是旧平台原文的唯一来源，2 仍要能写回', () => {
    expect(MULTI_MODE_OPTIONS.map((m) => m.value)).toEqual([1, 0, 2])
  })
})
