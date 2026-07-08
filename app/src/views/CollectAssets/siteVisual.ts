// 网站图标映射（0707 采集资产样式优化）：按名称/分类关键词挑一个语义相近的图标，
// 卡片视图的渐变瓦片与表格视图的行内小瓦片共用，保证同一网站两个视图下图标一致。
import type { Component } from 'vue'
import { Bell, ChatDotRound, Coin, Document, Monitor, TrendCharts } from '@element-plus/icons-vue'

export function siteIcon(site: { name: string; category?: string; categoryPath?: string }): Component {
  const key = `${site.name} ${site.categoryPath ?? ''} ${site.category ?? ''}`
  if (/行情/.test(key)) return TrendCharts
  if (/公告/.test(key)) return Bell
  if (/基金|支付宝/.test(key)) return Coin
  if (/舆情|微博|评论/.test(key)) return ChatDotRound
  if (/新闻|资讯|快讯/.test(key)) return Document
  return Monitor
}
