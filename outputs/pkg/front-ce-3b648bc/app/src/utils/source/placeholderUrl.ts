// 新建源的 URL 占位兜底（0904 I15 / Z8）。
//
// **为什么要有这东西**：后端新建源时 `url` 是必填的，不填直接报错（走查里开发原话
// 「他新建的时候后台这个 url 是必填的，会报错，这个要黄总改掉」）。
//
// 会上定的做法是**前端先吃药**（原则 D）：产品原话
// 「你可以默认生成一个呗……随便随机生成一个……**你不要搞必填**，就是相当于你可以让他生成一个，
//  尽量要想个方法去弥补他现在的问题，而不是说按照他现在的问题上去改，
//  然后后面就把这个按钮给去掉，不就解决了吗」。
//
// 即：**不要在前端加必填校验**（那是把后端的毛病转嫁给用户），而是空的时候补一个占位值，
// 等后端把必填去掉（I-E1）再把这里整个删掉。
//
// 占位值的两个要求：
//   1. **一眼看得出是占位**——不能像真 URL，否则以后没人分得清哪些是用户填的、哪些是补的；
//   2. **可被搜出来**——用 `.invalid` 顶级域（RFC 2606 保留，保证永不解析），
//      配合下面的前缀，清理时一条 SQL / 一次 grep 就能捞干净。
//
// TODO(I-E1)：后端去掉 `url` 必填后，删掉本文件与它的两个调用点
// （NewSiteWizard 的建站提交、SiteSourceSwitcher 的添加源），并清理库里已写入的占位值。

/** 占位 URL 的固定前缀，清理时按它捞 */
export const PLACEHOLDER_URL_PREFIX = 'http://placeholder.invalid/'

/** 这个 URL 是不是我们补的占位值 */
export function isPlaceholderUrl(url: string | undefined | null): boolean {
  return !!url && url.startsWith(PLACEHOLDER_URL_PREFIX)
}

/**
 * 用户没填 URL 时补一个占位值；填了就原样返回（**不做任何清洗**——用户填什么是什么）。
 *
 * @param sourceId 拼进占位值，方便回头定位是哪个源
 */
export function urlOrPlaceholder(url: string | undefined | null, sourceId?: string): string {
  const trimmed = (url ?? '').trim()
  if (trimmed) return trimmed
  const suffix = (sourceId ?? '').trim() || `t${Date.now().toString(36)}`
  return `${PLACEHOLDER_URL_PREFIX}${suffix}`
}
