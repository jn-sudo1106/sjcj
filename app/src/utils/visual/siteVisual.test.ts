import { describe, expect, it } from 'vitest'
import { Box, ChatDotRound, Coin, Document, Notebook, OfficeBuilding, Reading, TrendCharts } from '@element-plus/icons-vue'
import { siteIcon, siteTone } from './siteVisual'

// siteIcon 仍在用（流程画布等处按类型取图标），网站卡片改用首字后不再依赖它。
describe('siteIcon · 分类优先', () => {
  it('分类认得出来就按分类，不看名字', () => {
    expect(siteIcon({ name: '中国经营网', categoryPath: '/财经资讯/财经媒体' })).toBe(Document)
    expect(siteIcon({ name: '微博', categoryPath: '/财经资讯/社交平台' })).toBe(ChatDotRound)
    expect(siteIcon({ name: '智库报告', categoryPath: '/智库与研究机构' })).toBe(Notebook)
    expect(siteIcon({ name: '上市公司(已复核)', categoryPath: '/上市公司' })).toBe(OfficeBuilding)
  })

  it('分类为空时才回退到名字', () => {
    expect(siteIcon({ name: '涨停板' })).toBe(TrendCharts)
    expect(siteIcon({ name: '新浪财经1' })).toBe(Document)
  })

  // 2026-09-18：原先只有五六条关键词，一屏 8 张卡有 7 个落到默认的显示器图标（用户截图）。
  // 按真实网站名把常见词铺开，顺序即优先级——越具体的越靠前。
  it('按真实网站名挑得出不同图标', () => {
    expect(siteIcon({ name: '中国基金报' })).toBe(Coin)          // 基金 先于 报
    expect(siteIcon({ name: '上海证券报' })).toBe(TrendCharts)   // 证券 先于 报
    expect(siteIcon({ name: '我的钢铁网' })).toBe(Box)
    expect(siteIcon({ name: '新京报' })).toBe(Reading)
    expect(siteIcon({ name: '澎湃新闻' })).toBe(Document)
    expect(siteIcon({ name: '国内智库' })).toBe(Notebook)
    expect(siteIcon({ name: '小红书' })).toBe(ChatDotRound)
    expect(siteIcon({ name: '上市公司(已复核)' })).toBe(OfficeBuilding)
  })

  it('名字也认不出来时，按名字哈希取中性图标——稳定，且一屏不会全一样', () => {
    const unknown = ['人民网', '新华网', '同花顺', '每经网', '中新经纬', '量子位', '测试12']
    const picked = unknown.map((name) => siteIcon({ name }))
    // 同一个网站每次都一样
    expect(siteIcon({ name: '人民网' })).toBe(picked[0])
    // 七个认不出来的网站，至少能分出 4 种形状
    expect(new Set(picked).size).toBeGreaterThanOrEqual(4)
  })
})

// 2026-09-18 定稿：回到最早那套统一蓝渐变。
// 中途按网站名生成色相调了四轮（全色谱 → 冷色 → 纯蓝 → 渐变），30 多张卡片各一色整面墙还是花；
// 又试过统一配色 + 瓦片里放网站名前两个字，更难看。最后回到原点。
describe('siteTone · 全站统一', () => {
  it('不随网站变化，就是原来那套蓝渐变', () => {
    expect(siteTone()).toEqual(siteTone())
    expect(siteTone()).toEqual({
      bg: 'linear-gradient(135deg, #60a5fa, #2563eb)',
      fg: '#fff',
      shadow: '0 5px 12px -6px rgba(37, 99, 235, 0.55)',
    })
  })
})
