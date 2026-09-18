// 网站图标与配色（0707 采集资产样式优化；2026-09-18 重做配色）：
// 卡片视图的瓦片与表格视图的行内小瓦片共用，保证同一网站两个视图下一致。
//
// **图标表达"是什么类型"，颜色表达"是哪一个"** —— 两个维度各管各的：
//   - 图标按**分类**走（同类一致，帮人建立类型直觉）；
//   - 底色按**网站名**走（每个网站一个稳定的"视觉指纹"，扫卡片墙时靠颜色定位比读字快）。
//
// 改这套之前所有卡片都是同一个蓝色渐变瓦片，40px 见方里那点图标差异根本看不出来，
// 30 张卡片扫过去完全一样（2026-09-18 用户提）。
import type { Component } from 'vue'
import {
  Box, ChatDotRound, Coin, Compass, Connection, Cpu, Document, Files, Grid, Histogram,
  Link, Message, Monitor, Notebook, OfficeBuilding, Promotion, Reading, Stamp, Tickets,
  TrendCharts, VideoCamera,
} from '@element-plus/icons-vue'

/**
 * 关键词 → 图标。**顺序即优先级**，越具体的放越前面。
 *
 * 为什么规则这么碎：网站卡片上拿不到分类（`sitePaged` 的 `categoryName` 实测恒为 null），
 * 只能从名字里认。原先只有五六条规则，一屏 8 张卡有 7 个落到默认的显示器图标
 * （用户截图），所以按真实网站名把常见词都铺开。
 */
const KEYWORD_ICONS: [RegExp, Component][] = [
  [/智库|研究院|研究所|报告|洞察/, Notebook],
  [/微博|小红书|社区|论坛|社交|问答|贴吧/, ChatDotRound],
  [/涨停|行情|指数|股市|港股|A股|证券|股票|交易/, TrendCharts],
  [/基金|理财|银行|保险|财富|货币|资管/, Coin],
  [/钢铁|能源|化工|材料|制造|产业|矿|农|电力/, Box],
  [/视频|直播|影音|音频|电视|广播/, VideoCamera],
  [/政府|官方|部委|发改|监管|证监|央行|统计局/, Stamp],
  [/科技|数字|智能|AI|IT|芯片|半导体/, Cpu],
  [/榜单|排行|数据|统计|图谱/, Histogram],
  [/上市公司|公司|集团|企业|工商/, OfficeBuilding],
  // 「报」只认结尾，否则「报告」「报道」这类词会被抢走；具体的（基金报/证券报）在上面先命中
  [/日报|晚报|时报|周刊|杂志|出版|报$/, Reading],
  [/邮件|邮箱|订阅/, Message],
  [/新闻|资讯|快讯|头条|要闻|财经|经济|金融|报道|传媒|媒体/, Document],
]

/**
 * 认不出类型时从这里按名字挑一个——**纯粹为了不让一屏卡片长一样**。
 *
 * 这些图标本身不表达语义（否则就是误导），只求形状彼此拉开距离。
 * 同一个网站永远拿到同一个，靠的是下面的哈希。
 */
const NEUTRAL_ICONS: Component[] = [Monitor, Link, Compass, Connection, Tickets, Promotion, Grid, Files]

/**
 * 分类优先挑图标，分类为空再看名字，名字也认不出就按名字哈希取一个中性图标。
 *
 * 原实现把「名称 + 分类」拼成一个串做关键词正则，名字里没关键词就落到默认 `Monitor`——
 * 实测一整排「中国经营网 / 中国网财经 / 中国证券报…」全是同一个图标。
 */
export function siteIcon(site: { name: string; category?: string; categoryPath?: string }): Component {
  const cat = `${site.categoryPath ?? ''} ${site.category ?? ''}`
  if (/智库|研究/.test(cat)) return Notebook
  if (/社交|微博|舆情/.test(cat)) return ChatDotRound
  if (/上市公司|公司/.test(cat)) return OfficeBuilding
  if (/媒体|资讯|新闻/.test(cat)) return Document

  const name = site.name ?? ''
  for (const [re, icon] of KEYWORD_ICONS) {
    if (re.test(name)) return icon
  }
  return NEUTRAL_ICONS[hashOf(name) % NEUTRAL_ICONS.length]
}

/** 名字 → 稳定的正整数。同一个网站每次都拿到同一个中性图标。 */
function hashOf(name: string): number {
  let h = 0
  for (const ch of String(name ?? '')) h = (h * 31 + ch.charCodeAt(0)) | 0
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return Math.abs(h)
}

/**
 * 瓦片配色：**全站统一的蓝渐变**，就是最早那一套（2026-09-18 定稿）。
 *
 * 中间按网站名生成色相调了四轮（全色谱 → 冷色 → 纯蓝 → 渐变），30 多张卡片各一个颜色
 * 整面墙还是花；又试过统一配色 + 瓦片里放网站名前两个字，用户看了觉得更难看。
 * 最后回到原点：统一蓝渐变 + 类型图标，区分交给图标形状和卡片标题。
 *
 * 保留函数形态而不是写死在 CSS 里：卡片与表格两处共用它，将来若要按分类上色，
 * 只改这一个函数即可。
 */
export type SiteTone = { bg: string; fg: string; shadow: string }

export function siteTone(): SiteTone {
  return {
    bg: 'linear-gradient(135deg, #60a5fa, #2563eb)',
    fg: '#fff',
    shadow: '0 5px 12px -6px rgba(37, 99, 235, 0.55)',
  }
}
