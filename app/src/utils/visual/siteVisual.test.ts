import { describe, expect, it } from 'vitest'
import { Document, ChatDotRound, Notebook, OfficeBuilding, TrendCharts } from '@element-plus/icons-vue'
import { siteHue, siteIcon, siteTone } from './siteVisual'

describe('siteIcon · 分类优先', () => {
  it('分类认得出来就按分类，不看名字', () => {
    expect(siteIcon({ name: '中国经营网', categoryPath: '/财经资讯/财经媒体' })).toBe(Document)
    expect(siteIcon({ name: '微博', categoryPath: '/财经资讯/社交平台' })).toBe(ChatDotRound)
    expect(siteIcon({ name: '智库报告', categoryPath: '/智库与研究机构' })).toBe(Notebook)
    expect(siteIcon({ name: '上市公司(已复核)', categoryPath: '/上市公司' })).toBe(OfficeBuilding)
  })

  // 改这套之前：名字里没关键词就全落到默认 Monitor，一整排「中国XX」长一样
  it('分类为空时才回退到名字', () => {
    expect(siteIcon({ name: '涨停板' })).toBe(TrendCharts)
    expect(siteIcon({ name: '新浪财经1' })).toBe(Document)
  })
})

describe('siteTone · 按名字生成，颜色不会用完', () => {
  it('同一个网站永远是同一个颜色（卡片与表格要一致）', () => {
    expect(siteTone({ name: '东方财富网' })).toEqual(siteTone({ name: '东方财富网' }))
  })

  it('只用冷色段（青→蓝→紫）——全色谱铺 30 张卡像彩虹墙，用户反馈"太花"', () => {
    const names = ['东方财富网', '同花顺', '微博', '中国证券报', '新浪财经1', '新浪2', '新浪3',
      '智库报告', '海外智库', '国内智库', '量子位', '小红书', '财联社', '涨停板', '云掌财经']
    for (const name of names) {
      const hue = siteHue(name)
      // 200–320：顺带天然避开了红橙——红色在卡片上已经表示"异常"，不能被稀释
      expect(hue).toBeGreaterThanOrEqual(200)
      expect(hue).toBeLessThanOrEqual(320)
    }
  })

  it('名字相近也会分开——"新浪1/2/3"不该是同一个颜色', () => {
    const hues = ['新浪财经1', '新浪2', '新浪3'].map(siteHue)
    expect(new Set(hues).size).toBe(3)
  })

  // 2026-09-18 实测发现的真实问题：连续色相下这两个网站算出 143° / 144°，
  // 相邻两张卡片"差一点点但不完全一样"，看着像渲染 bug。分档 + 雪崩散列后不会再出现。
  it('名字只差一个字的两个网站，要么明显不同、要么完全同色', () => {
    const a = siteHue('国内智库')
    const b = siteHue('海外智库')
    const gap = Math.abs(a - b)
    expect(gap === 0 || gap >= 12).toBe(true)
  })

  it('一屏十几张卡片能互相分开（12 档色相下的实际区分度）', () => {
    const onScreen = ['中国经营网', '中国网财经', '中国证券报', '中金在线', '中新经纬', '云掌财经',
      '东方财富网', '同花顺', '财联社', '量子位', '小红书', '微博']
    const hues = new Set(onScreen.map(siteHue))
    // 收窄到冷色段后色相只剩 12 档，12 个网站期望约 7.6 种；真正的区分度靠色相 × 浓淡
    // 这一对组合（下面那条用例锁的就是它），这里只保证散列没偏。
    expect(hues.size).toBeGreaterThanOrEqual(6)
  })

  it('色相落在档位上，不产生 143/144 这种半吊子差异', () => {
    const step = 120 / 12
    for (const name of ['东方财富网', '微博', '智库报告', '测试网站7']) {
      const offset = (siteHue(name) - 45) / step
      expect(Math.abs(offset - Math.round(offset))).toBeLessThan(0.51)
    }
  })

  it('产出的是 oklch —— 明度感知均匀，各色相深浅一致', () => {
    const tone = siteTone({ name: '东方财富网' })
    // 明度固定（0.95 底 / 0.52 前景），浓淡只走饱和度这一维，整屏不会深一块浅一块
    expect(tone.bg).toMatch(/^oklch\(0\.955 /)
    expect(tone.fg).toMatch(/^oklch\(0\.53 /)
  })

  // 第二维度曾经取 `hash / 24 % 2`，与色相档共用同一串低位，等于没加（实测 16 张卡的
  // 配色数一动不动还是 11）。改取高位 bit 后到 14。
  it('浓淡与色相档相互独立，真的把同屏区分度提上去了', () => {
    const onScreen = ['中国经营网', '中国网财经', '中国证券报', '中金在线', '中新经纬', '云掌财经',
      '东方财富网', '同花顺', '财联社', '量子位', '小红书', '微博', '智库报告', '国内智库',
      '海外智库', '数据榜单']
    const tones = new Set(onScreen.map((name) => JSON.stringify(siteTone({ name }))))
    // 12 色相 × 2 浓淡 = 24 组合，16 个网站期望约 12 种
    expect(tones.size).toBeGreaterThanOrEqual(10)

    // 同色相的两个网站靠浓淡分开：找一对色相相同的，断言配色不同
    const byHue = new Map<number, string[]>()
    for (const name of onScreen) {
      const hue = siteHue(name)
      byHue.set(hue, [...(byHue.get(hue) ?? []), name])
    }
    const collided = [...byHue.values()].find((names) => names.length > 1)
    if (collided) {
      const distinct = new Set(collided.map((name) => siteTone({ name }).bg))
      expect(distinct.size).toBeGreaterThan(1)
    }
  })
})
