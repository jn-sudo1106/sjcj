// 文章打标签的结果解析（2026-09-18）：模型输出是 JSON，但常包在 ```json 里、或前后带说明；
// 解析要容错，解析不出要能退回原文展示（界面据此决定），不能把原文丢了。
import { describe, expect, it } from 'vitest'
import { ARTICLE_TAG_DIMENSIONS, extractJsonObject, parseArticleTags, riskLevelTone } from './articleTags'

const SAMPLE = {
  summary: '某市地铁故障停运两小时，官方未回应引发不满',
  labels: {
    topic: ['社会'],
    sentiment: '负面',
    emotion_intensity: '强',
    emotion_type: ['愤怒', '失望'],
    intent: ['投诉'],
    risk: ['涉稳'],
    risk_level: '中危',
    spread: ['原创', '情绪煽动'],
    subject: ['政府部门', '网民'],
    region: ['国内'],
    time_feature: ['突发事件'],
    language: ['口语', '网络用语'],
  },
  confidence: 0.9,
  evidence: { sentiment: '太让人失望了', risk: '官方到现在连个说明都没有', topic: '某市地铁又出故障了' },
  uncertain: false,
}

describe('文章打标签 · 结果解析', () => {
  it('标准 JSON：摘要 / 各维度标签 / 置信度 / 依据都解析出来', () => {
    const result = parseArticleTags(JSON.stringify(SAMPLE))
    expect(result).not.toBeNull()
    expect(result!.summary).toContain('地铁故障')
    expect(result!.confidence).toBe(0.9)
    expect(result!.uncertain).toBe(false)
    // 维度按标签体系的顺序输出，且只保留有值的维度
    expect(result!.groups.map((g) => g.label)).toEqual([
      '主题', '情感', '情绪强度', '情绪类型', '意图', '风险', '风险等级', '传播特征', '主体', '地域', '时间特征', '语言特征',
    ])
    expect(result!.groups.find((g) => g.key === 'risk')!.values).toEqual(['涉稳'])
    expect(result!.groups.find((g) => g.key === 'risk_level')!.values).toEqual(['中危'])
    // 依据按标签体系的维度顺序排（主题在前），不按 JSON 里的键序
    expect(result!.evidence.map((e) => e.label)).toEqual(['主题', '情感', '风险'])
    expect(result!.evidence.find((e) => e.label === '情感')!.text).toBe('太让人失望了')
  })

  it('包在 ```json 代码块 / 前后带说明文字也能解析', () => {
    const raw = `好的，我来标注：\n\n\`\`\`json\n${JSON.stringify(SAMPLE)}\n\`\`\`\n\n以上。`
    expect(parseArticleTags(raw)!.summary).toContain('地铁故障')
    const plain = `标注结果如下：{"summary":"只有摘要","labels":{"topic":["科技"]}}`
    expect(parseArticleTags(plain)!.groups[0].values).toEqual(['科技'])
  })

  it('标签值写在字符串里含花括号也不截断（按字符串状态扫描）', () => {
    const raw = '{"summary":"含 { 和 } 的摘要","labels":{"topic":["社会"]}}'
    expect(parseArticleTags(raw)!.summary).toBe('含 { 和 } 的摘要')
    expect(parseArticleTags(raw)!.groups[0].values).toEqual(['社会'])
  })

  it('labels 平铺在顶层（有些模型不套 labels）也能认', () => {
    const result = parseArticleTags('{"summary":"x","topic":["体育"],"sentiment":"正面"}')
    expect(result!.groups.map((g) => g.label)).toEqual(['主题', '情感'])
  })

  it('解析不出 JSON 时返回 null（界面退回展示原文）', () => {
    expect(parseArticleTags('这段文本没法标注')).toBeNull()
    expect(parseArticleTags('')).toBeNull()
    expect(parseArticleTags('{不完整的 JSON')).toBeNull()
  })

  it('confidence 缺失/非法给 null，uncertain 支持字符串 true', () => {
    const result = parseArticleTags('{"labels":{"topic":["社会"]},"uncertain":"true"}')
    expect(result!.confidence).toBeNull()
    expect(result!.uncertain).toBe(true)
  })

  it('extractJsonObject 抠出第一个完整对象', () => {
    expect(extractJsonObject('前言 {"a":1} 后话 {"b":2}')).toBe('{"a":1}')
    expect(extractJsonObject('没有对象')).toBe('')
  })

  it('维度表与提示词的标签体系一致（12 个维度）', () => {
    expect(ARTICLE_TAG_DIMENSIONS).toHaveLength(12)
    expect(ARTICLE_TAG_DIMENSIONS.map((d) => d.key)).toContain('risk_level')
  })

  it('风险等级给对应的强调色档位', () => {
    expect(riskLevelTone('高危')).toBe('high')
    expect(riskLevelTone('中危')).toBe('mid')
    expect(riskLevelTone('低危')).toBe('low')
    expect(riskLevelTone('无风险')).toBe('none')
    expect(riskLevelTone('')).toBe('none')
  })
})
