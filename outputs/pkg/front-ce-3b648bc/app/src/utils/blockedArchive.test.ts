import { describe, expect, it } from 'vitest'
import { detectBlockedArchive, visibleTextOf } from './blockedArchive'

// 取自生产实测的那份 18 KB 存档（mp_weixin_qq_com/20260826/c324fdca…/content.html）：
// 可见文本只有 65 字，正文位置上是微信的反爬验证页。
const WX_BLOCKED = `<!DOCTYPE html><html><head><title>环境异常</title>
<script src="//res.wx.qq.com/mmbizwap/zh_CN/htmledition/js/lib/wa-helper.min.js"></script>
<script src="https://captcha.gtimg.com/TCaptcha.js"></script></head>
<body><div class="weui-msg__title">环境异常</div>
<p class="weui-msg__desc">当前环境异常，完成验证后即可继续访问。</p>
<a class="weui-btn">去验证</a></body></html>`

describe('detectBlockedArchive', () => {
  it('认出微信的「环境异常」验证页，并摘出原话当证据', () => {
    const v = detectBlockedArchive(WX_BLOCKED)
    expect(v.blocked).toBe(true)
    expect(v.hint).toContain('环境异常')
  })

  it('正文够长且无拦截文案的正常文章不误判', () => {
    const article = `<html><body><h1>技术跃迁筑行业新生态</h1><div class="rich_media_content">${'正文内容。'.repeat(80)}</div></body></html>`
    expect(detectBlockedArchive(article).blocked).toBe(false)
  })

  // 文案没见过的拦截页靠这条兜住：正文短到几十字，不可能是一篇文章
  it('可见文本短得不像正文时也判为被拦', () => {
    expect(detectBlockedArchive('<html><body><p>系统繁忙</p></body></html>').blocked).toBe(true)
  })

  it('Cloudflare 的挑战页同样认得', () => {
    expect(detectBlockedArchive(`<html><body><h1>Just a moment...</h1>${'x'.repeat(900)}</body></html>`).blocked).toBe(true)
  })

  // 别把正常文章里出现的功能字样当拦截——那会把好数据说成坏的，比漏判更糟
  it('正文里提到「登录」「订阅」这类正常字样不算被拦', () => {
    const article = `<html><body><div>${'关注公众号，登录后订阅更多内容。'.repeat(40)}</div></body></html>`
    expect(detectBlockedArchive(article).blocked).toBe(false)
  })

  it('visibleTextOf 剥掉 script/style 与注释', () => {
    const t = visibleTextOf('<style>.a{color:red}</style><script>var a=1</script><!-- c --><p>正文</p>')
    expect(t).toBe('正文')
  })
})

// 2026-09-11 实测踩到的：某些存档里关键词只出现在 script / 属性中，可见文本里没有。
// 此前会从文本开头硬切当"原话"，切出的是「视频 小程序 赞，轻点两下取消赞」这类页脚碎词，
// 弹窗上引述了一堆标点和无关词，看着像乱码。
describe('detectBlockedArchive · 引述只取可见文本里的原话', () => {
  it('关键词只在 script 里时不引述，改按"没有正文"表述', () => {
    const html = `<html><head><script>var captchaTip='请稍后重试'</script></head>`
      + `<body><div>： ， 。 视频 小程序 赞 ，轻点两下取消赞 在看</div></body></html>`
    const v = detectBlockedArchive(html)
    expect(v.blocked).toBe(true)
    expect(v.reason).toBe('thin')
    // 关键：不要把页脚碎词当原话引出来
    expect(v.hint).toBe('')
    expect(v.textLength).toBeGreaterThan(0)
  })

  it('认出拦截文案时带上 reason=pattern 与原话', () => {
    const v = detectBlockedArchive('<html><body><p>当前环境异常，完成验证后即可继续访问。</p></body></html>')
    expect(v.reason).toBe('pattern')
    expect(v.hint).toContain('完成验证后即可继续访问')
    // 引述截到句末，不拖上后面的碎词
    expect(v.hint.endsWith('。')).toBe(true)
  })

  it('正文够长且关键词只在源码里时不判为被拦', () => {
    const html = `<html><head><script>var t='人机验证'</script></head><body>${'正文内容。'.repeat(80)}</body></html>`
    expect(detectBlockedArchive(html).blocked).toBe(false)
  })
})
