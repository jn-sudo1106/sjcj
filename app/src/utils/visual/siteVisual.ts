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
import { Bell, ChatDotRound, Coin, Document, Monitor, Notebook, OfficeBuilding, TrendCharts } from '@element-plus/icons-vue'

/**
 * 分类优先挑图标。
 *
 * 原实现把 `名称 + 分类` 拼成一个字符串做关键词正则，名字里没关键词就落到默认 `Monitor`——
 * 实测一整排「中国经营网 / 中国网财经 / 中国证券报…」全是默认图标。分类是结构化数据，
 * 比从名字里猜可靠，所以先看分类，名字只作兜底。
 */
export function siteIcon(site: { name: string; category?: string; categoryPath?: string }): Component {
  const cat = `${site.categoryPath ?? ''} ${site.category ?? ''}`
  if (/智库|研究/.test(cat)) return Notebook
  if (/社交|微博|舆情/.test(cat)) return ChatDotRound
  if (/上市公司|公司/.test(cat)) return OfficeBuilding
  if (/媒体|资讯|新闻/.test(cat)) return Document

  // 分类认不出来时再看名字（老数据里不少网站分类是空的）
  const key = `${site.name} ${cat}`
  if (/行情|涨停|股/.test(key)) return TrendCharts
  if (/公告/.test(key)) return Bell
  if (/基金|支付宝|理财/.test(key)) return Coin
  if (/舆情|微博|评论|社区/.test(key)) return ChatDotRound
  if (/新闻|资讯|快讯|报|财经|财富/.test(key)) return Document
  return Monitor
}

/**
 * 底色按网站名生成的色相。
 *
 * **为什么不是固定调色板**：网站数量会一直涨（用户 2026-09-18 提醒）。8 色的盘子在 30 个
 * 网站时每色 4 个还行，到 300 个就是每色 37 个，"视觉指纹"也就没了。改成从名字哈希出一个
 * 色相角，颜色不会用完。
 *
 * **避开红橙（色相 0–45）**：卡片上红色已经有语义——出错的源 chip、工具栏的「出错源 N」
 * 都是红的。图标再混进红橙，那个警示信号就被稀释了。所以色相只在 45–340 之间取。
 *
 * 用 `oklch` 而不是 `hsl`：oklch 的明度是**感知**均匀的，同一个 L 值下黄色和蓝色看着一样亮；
 * hsl 在固定 L 时黄色会明显偏亮、蓝色偏暗，30 张卡片摆一起深浅不齐很难看。
 */
const HUE_MIN = 45
const HUE_SPAN = 295   // 45..340，跳过红橙那一段
/**
 * 色相取**离散档位**而不是连续值。
 *
 * 连续取值实测出过这种情况：「国内智库」143°、「海外智库」144° —— 两张相邻卡片
 * "差一点点但不完全一样"，看着像渲染 bug 而不像设计。分档之后两个网站要么明显不同、
 * 要么就是同一个颜色（同色看起来像"同一类"，不刺眼）。
 *
 * 24 档 ≈ 每 12.3 度一档，是浅底小色块上还能一眼分辨的粒度。网站数量继续涨也不必加档：
 * 人眼在这种尺寸下能可靠区分的色相本来就二十来种，"每个网站一个独有颜色"是伪需求——
 * 真正有用的是**同屏这十几张卡片互相可辨**。真到了一屏撞色太多，再加一档明度做第二维度
 * （24 × 2 = 48 组合），比继续细分色相有效。
 */
const HUE_STEPS = 24

/**
 * murmur3 的 fmix32 收尾。
 *
 * 光用 `h*31+c` 那种累加哈希，相近的名字容易落到相近的桶（上面 143/144 就是这么来的）。
 * 这一轮位混淆有雪崩效应：输入差一个字，输出的档位就完全无关。
 */
function mix32(n: number): number {
  let h = n | 0
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  h = Math.imul(h, 0x45d9f3b)
  h ^= h >>> 16
  return Math.abs(h)
}

function nameHash(name: string): number {
  let h = 0
  for (const ch of String(name ?? '')) h = (h * 31 + ch.charCodeAt(0)) | 0
  return mix32(h)
}

export function siteHue(name: string): number {
  const step = nameHash(name) % HUE_STEPS
  return Math.round(HUE_MIN + step * (HUE_SPAN / HUE_STEPS))
}

/**
 * 第二维度：**浓淡**（同色相的深浅两档）。
 *
 * 24 档色相在一屏十几张卡片时会撞——不是散列偏了，是生日问题：24 档放 16 个，
 * 不同色数的期望值就是 11.9（实测 11，正正好）。加一档浓淡把组合变成 24×2=48，
 * 同样 16 个的期望不同色数升到约 13.9。
 *
 * 选**饱和度**而不是明度做第二维度：明度分档会让一屏卡片深一块浅一块、层次乱掉；
 * 饱和度只影响鲜艳程度（灰蓝 vs 鲜蓝），明度保持一致，整体仍然整齐。
 */
function siteVivid(name: string): boolean {
  // 取**高位**的一个 bit，不是 `hash / HUE_STEPS % 2`。
  // 后者踩过坑：实测「中国经营网 / 云掌财经 / 量子位 / 微博」四个 hash 相差十亿以上，
  // 却同时满足 hash ≡ 34 (mod 48)——两个维度都从同一串低位取，第二维度等于没加，
  // 16 张卡的配色数纹丝不动还是 11。改用高位后是 14。
  return ((nameHash(name) >>> 20) & 1) === 1
}

export type SiteTone = { bg: string; fg: string }

/** 瓦片配色：浅底 + 同色系深色图标。对比度由固定的 L 值保证（0.96 底 / 0.52 前景）。 */
export function siteTone(site: { name: string }): SiteTone {
  const hue = siteHue(site.name)
  const vivid = siteVivid(site.name)
  return {
    bg: `oklch(0.95 ${vivid ? '0.078' : '0.038'} ${hue})`,
    fg: `oklch(0.52 ${vivid ? '0.17' : '0.115'} ${hue})`,
  }
}
