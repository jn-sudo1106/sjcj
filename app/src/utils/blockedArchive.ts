// 采集存档的"抓砸了"判定（2026-09-11）。
//
// 背景：生产上点开一篇微信文章的存档，弹窗里只有一句「mp.weixin.qq.com 拒绝了我们的
// 连接请求」。查下来不是预览坏了，是**这条数据本身采坏了**——那次采集被微信反爬拦下，
// 返回的是「环境异常，完成验证后即可继续访问」的验证页，而系统把这个验证页当成正文
// 存进了 OSS。预览时 iframe 加载它，页面里的微信脚本（wa-helper / moon / TCaptcha）
// 跑起来把 iframe 自己导航去 mp.weixin.qq.com 做验证，微信再用 X-Frame-Options 拒掉。
//
// 实测对比（同一批 mp_weixin_qq_com 的存档）：
//   正常文章  3.2 MB / 可见文本 1500~2000 字
//   验证页    18 KB  / 可见文本 65 字（「环境异常 当前环境异常，完成验证后即可继续访问」）
//
// 判定出来是为了**把话说对**：显示「无法预览」会让人以为是本系统的能力问题，
// 而实际该看见的是「这条数据采集时被对方拦下了」。文案的主语必须是采集，不是预览。

/** 粗筛阈值：超过这个体积就不值得再去 fetch 内容判定了，正常文章都在 MB 级。 */
export const BLOCKED_ARCHIVE_SIZE_LIMIT = 200 * 1024

/** 细判时只看前这么多字节——验证页本身就小，正文靠后的长文不是我们要找的。 */
export const BLOCKED_ARCHIVE_SNIFF_BYTES = 64 * 1024

/**
 * 反爬拦截页的文案特征。命中任意一条即可。
 * 只收**明确表示"没拿到内容"**的说法，不收"登录""订阅"这类正常的功能提示——
 * 后者可能出现在正常文章的页脚里，误判会把好数据说成坏的。
 */
const BLOCKED_PATTERNS = [
  '环境异常',
  '完成验证',
  '去验证',
  '访问过于频繁',
  '请求过于频繁',
  '稍后再试',
  '请稍后重试',
  '验证码',
  '人机验证',
  '拒绝访问',
  '403 Forbidden',
  'Access Denied',
  'Just a moment', // Cloudflare 挑战页
  'Checking your browser',
]

/** 可见文本短到这个程度，基本不可能是一篇正文。 */
const THIN_TEXT_CHARS = 200

/** 从 HTML 里粗略取可见文本：剥掉 script/style，再去标签。够用即可，不求精确。 */
export function visibleTextOf(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface BlockedArchiveVerdict {
  /** 判定为"采集时被拦下"，存档里不是正文 */
  blocked: boolean
  /** 命中的特征文案，用于在界面上引述原文，比我们自己转述更有说服力 */
  hint: string
}

/**
 * 判断一份 HTML 存档是不是反爬拦截页。
 *
 * 两条独立依据，命中其一即判定：
 *  1. 文案命中已知的拦截提示；
 *  2. 可见文本短得不像正文（<200 字）——覆盖那些文案没见过的拦截页。
 *
 * 判不出来就返回 false，退回正常的 iframe 预览，不会比现状更糟。
 */
export function detectBlockedArchive(html: string): BlockedArchiveVerdict {
  const text = visibleTextOf(html)
  const hit = BLOCKED_PATTERNS.find((p) => text.includes(p) || html.includes(p))
  if (hit) {
    // 把命中处那句话摘出来当证据，比只报"命中关键词"有用。
    // **截到句末为止**：拦截页正文后面常跟着「视频 小程序 赞…」这类页脚碎词，
    // 按固定长度硬切会把它们一起带进来，引述看着像乱码。
    const at = text.indexOf(hit)
    const from = at >= 0 ? Math.max(0, at - 10) : 0
    const window = text.slice(from, from + 80)
    const end = window.search(/[。！？.!?]/)
    return { blocked: true, hint: (end > 0 ? window.slice(0, end + 1) : window.slice(0, 40)).trim() }
  }
  if (text.length > 0 && text.length < THIN_TEXT_CHARS) {
    return { blocked: true, hint: text }
  }
  return { blocked: false, hint: '' }
}
