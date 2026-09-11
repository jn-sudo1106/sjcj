<script setup lang="ts">
// 原始文件站内预览（0819 N2-1/N2-2，会议 15:21"他其实现在是没有预览的，我们是需要新做一个预览"）。
//
// 三个关键约束都是生产实测出来的（方案 §7.4.1）：
// 1. 通路只有 K3 + OSS 代理。K9「文本路径」整列为空，K2「文件链接」是源站原始外网地址
//    （跨域且可达性不保证），K2 只能用于「新窗口打开」。
// 2. 取字节流必须不带 Cookie，否则 OSS 返回 500。这也是**连 PDF 和图片都要先 fetch 再转
//    blob URL** 的原因——直接把地址塞给 <iframe src> / <img src>，浏览器会按同源请求自动
//    带上 Cookie，照样 500。
// 3. Excel 组件的 src 传 ArrayBuffer 而不是 URL，同理：组件内部自己取数会带 Cookie。
//
// 真实类型分布（文件中心首页 20 行）：xlsx 13 / pdf 7 / txt 0，故 Excel 是主力路径。
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { extFromName, fetchOssFile, fetchOssFileHead, mimeTypeOf, ossPublicUrl, previewKindOf, type PreviewKind } from '@/utils/ossFile'
import {
  BLOCKED_ARCHIVE_SIZE_LIMIT, BLOCKED_ARCHIVE_SNIFF_BYTES, detectBlockedArchive,
  type BlockedArchiveVerdict,
} from '@/utils/blockedArchive'

const props = defineProps<{
  /** K3 文件路径（OSS 上的路径），站内预览的唯一来源 */
  path?: string | null
  /** K1 文件名 / K6 展示名，用作标题与下载文件名 */
  name?: string | null
  /** K7 扩展名；缺失时从文件名兜底推断 */
  ext?: string | null
  /** K4 文件大小（字节）；过大时不自动加载，避免点一下就拉几十兆 */
  size?: number | string | null
  /** K2 原始外网地址，仅用于「新窗口打开」，不用于取内容 */
  externalUrl?: string | null
}>()

// Excel 解析 + 渲染体积不小（gzip 约 548KB），按需加载，不进首屏包
const ExcelViewer = defineAsyncComponent(async () => {
  await import('@lucky-office/excel/lib/index.css')
  return (await import('@lucky-office/excel')).default
})

const AUTO_LOAD_LIMIT = 20 * 1024 * 1024
const TEXT_LIMIT = 2 * 1024 * 1024

// HTML 预览**不 fetch 字节、不做任何改写**，iframe 直接指向 OSS 的独立 origin 绝对地址
// （2026-09-09 定案，用户原话「不要加任何样式，该什么样就是什么样」「旧平台怎样我们就怎样」）。
//
// 为什么 html 必须走绝对地址，而其余类型继续走 blob：
//   采集页的正文常常要靠**页面自己的脚本**才显示（实测三友医疗这类 Next.js 站点：正文完整
//   躺在静态 HTML 里，但祖先 div 是 display:none，由页面脚本解除）。而 blob URL 的 origin
//   继承创建它的页面，也就是我们自己——于是两头堵死：
//     · 不给 allow-same-origin → opaque origin → 脚本一碰 localStorage 就 SecurityError，
//       正文永远出不来；
//     · 给 allow-same-origin → 它拿到的是**我们的** origin，采集来的不可信脚本就能读
//       localStorage 里的登录 token。
//   iframe 直接指向 9102 那个绝对地址就绕开了这道题：文档 origin 是 118.25.96.217:9102
//   本身，与本应用天然不同源，脚本正常跑、正文正常显示，却碰不到我们的任何东西。
//   这里的 sandbox="allow-scripts allow-same-origin" 也因此是安全的——同时给这两项只有在
//   iframe 与父页面**同源**时才能脱出沙箱，而这里恰恰跨源。
//   顺带：原注释里「必须先 fetch 成 blob，否则带 Cookie 会让 OSS 返回 500」只对同源代理成立，
//   跨站 iframe 根本不会带上我们的 cookie。
//
// 拆掉过的两层包装（都是被这个问题逼出来的补丁，现已删除）：
//  1) 一段兜底排版 <style>（15px 正文、body 限宽 820px 居中、表格描边…）；
//  2) <base href="源站">——它让源站 CSS 加载成功，而那套 CSS 在没有 JS 时正好把正文压在
//     自己的 loading 遮罩底下，加了反而更看不到正文。
const effectiveExt = computed(() => props.ext || extFromName(props.name))
const kind = computed<PreviewKind>(() => previewKindOf(effectiveExt.value))
const sizeNum = computed(() => {
  const n = Number(props.size)
  return Number.isFinite(n) && n > 0 ? n : 0
})
const oversize = computed(() => sizeNum.value > AUTO_LOAD_LIMIT)
/** html 走 OSS 独立 origin 的绝对地址，不经 fetch，也不受体积上限约束（浏览器自己流式加载）。 */
const htmlSrc = computed(() => (kind.value === 'html' && props.path ? ossPublicUrl(props.path) : ''))

const loading = ref(false)
const error = ref('')
// 采集被拦判定（2026-09-11）：只对"体积小得不像正文"的 HTML 存档做，正常的 MB 级文章
// 一个字节都不多读。判出来是为了把话说对——见 utils/blockedArchive.ts 顶部。
const blocked = ref<BlockedArchiveVerdict | null>(null)
const forced = ref(false)
const buffer = ref<ArrayBuffer | null>(null)
const blobUrl = ref('')
const text = ref('')
const truncated = ref(false)

function releaseBlob() {
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value)
  blobUrl.value = ''
}
function reset() {
  releaseBlob()
  buffer.value = null
  text.value = ''
  truncated.value = false
  error.value = ''
  forced.value = false
  blocked.value = null
}

/**
 * HTML 存档的"抓砸了"探测。**只在体积粗筛命中时才发这一次请求**：
 * 正常文章 3MB 级直接跳过，渲染路径一如既往交给 iframe（0909 定案：html 不 fetch 字节，
 * 由 iframe 按 OSS 绝对地址自己加载）。这里读到的字节只用于判定，不参与渲染。
 */
async function sniffBlocked() {
  if (kind.value !== 'html' || !props.path) return
  // 体积已知且明显不小时跳过：正常文章都在 MB 级，没必要探。
  // 体积未知时照样探——调用方目前并不传 size，而**只读头部**，代价就是几十 KB。
  if (sizeNum.value > BLOCKED_ARCHIVE_SIZE_LIMIT) return
  try {
    const buf = await fetchOssFileHead(props.path, BLOCKED_ARCHIVE_SNIFF_BYTES)
    const verdict = detectBlockedArchive(new TextDecoder('utf-8').decode(buf))
    if (verdict.blocked) blocked.value = verdict
  } catch {
    // 探测失败不影响预览：照常渲染 iframe，退回改动前的行为
  }
}

/** 能预览、有路径、且（没超限或用户点了"仍要预览"）才真正去取。
 *  html 不在此列——它由 iframe 自己按绝对地址加载，前端不碰字节。 */
const shouldLoad = computed(() => !!props.path && kind.value !== 'none' && kind.value !== 'html' && (!oversize.value || forced.value))

async function load() {
  if (!shouldLoad.value || !props.path) return
  loading.value = true
  error.value = ''
  try {
    const buf = await fetchOssFile(props.path)
    if (kind.value === 'excel') {
      buffer.value = buf
    } else if (kind.value === 'text') {
      truncated.value = buf.byteLength > TEXT_LIMIT
      const slice = truncated.value ? buf.slice(0, TEXT_LIMIT) : buf
      text.value = new TextDecoder('utf-8').decode(slice)
    } else {
      releaseBlob()
      // 必须带 MIME：无类型的 blob URL 会被当成 text/plain，PDF 在 <iframe> 里
      // 显示成 `%PDF-1.7 …` 的二进制原文（2026-08-24 实测）。
      blobUrl.value = URL.createObjectURL(new Blob([buf], { type: mimeTypeOf(effectiveExt.value) }))
    }
  } catch (e) {
    // 不静默失败：把原因摆出来，同时下方仍保留下载与「新窗口打开」两条退路
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(() => [props.path, props.ext, props.name] as const, () => {
  reset()
  void load()
  void sniffBlocked()
}, { immediate: true })
watch(forced, (on) => { if (on) void load() })
onBeforeUnmount(releaseBlob)

function onExcelError(e: unknown) {
  error.value = `Excel 解析失败：${e instanceof Error ? e.message : String(e)}`
}
</script>

<template>
  <div class="fp-wrap">
    <div v-if="!path" class="fp-hint" data-testid="file-preview-nopath">该文件未提供可访问地址，无法预览</div>

    <div v-else-if="kind === 'none'" class="fp-hint" data-testid="file-preview-unsupported">
      该类型不支持站内预览（{{ ext || extFromName(name) || '未知类型' }}），可下载后查看
    </div>

    <div v-else-if="oversize && !forced" class="fp-hint" data-testid="file-preview-oversize">
      文件较大（{{ (sizeNum / 1024 / 1024).toFixed(1) }} MB），未自动加载
      <button class="rc-btn" type="button" @click="forced = true">仍要预览</button>
    </div>

    <div v-else-if="loading" class="fp-hint" data-testid="file-preview-loading">加载中…</div>

    <div v-else-if="error" class="fp-hint error" data-testid="file-preview-error">{{ error }}</div>

    <!-- 采集时被对方站点拦下（2026-09-11）。
         **文案的主语必须是采集，不能写"无法预览"**——后者会让人以为是本系统的能力问题，
         而真正该被看见的是这条数据没抓到正文。引述存档里的原话，比我们转述更有说服力。 -->
    <div v-else-if="blocked" class="fp-blocked" data-testid="file-preview-blocked">
      <div class="fp-blocked-title">这条数据采集时被对方站点拦下了</div>
      <p class="fp-blocked-body">
        <template v-if="blocked.reason === 'pattern'">存档里是一张拦截/验证页，不是文章正文</template>
        <template v-else>存档里没有正文，只有 {{ blocked.textLength }} 个字的页面框架</template><template v-if="sizeNum">（仅 {{ (sizeNum / 1024).toFixed(0) }} KB，同类正文通常在 MB 级）</template>。
      </p>
      <!-- 只有真从**可见文本**里认出拦截提示时才引述；否则没有原话可引，
           硬引会引出「视频 小程序 赞」这类页脚碎词（2026-09-11 实测踩过）。 -->
      <p v-if="blocked.reason === 'pattern' && blocked.hint" class="fp-blocked-quote">「{{ blocked.hint }}」</p>
      <p class="fp-blocked-body muted">这不代表原文打不开——原文多半正常，只是这次没采到。</p>
    </div>

    <template v-else>
      <ExcelViewer
        v-if="kind === 'excel' && buffer"
        class="fp-excel"
        data-testid="file-preview-excel"
        :src="buffer"
        @error="onExcelError"
      />
      <iframe v-else-if="kind === 'pdf' && blobUrl" class="fp-frame" data-testid="file-preview-pdf" :src="blobUrl" title="PDF 预览" />
      <!-- 采集到的页面属于不可信内容：用无权限 sandbox 渲染，既展示页面而不是源码，也禁止脚本接触应用。
           2026-09-09 试过放开 allow-scripts（想让 Next.js 这类站点水合出正文），当场实测无效并已回退：
           不带 allow-same-origin 时文档是 opaque origin，脚本一碰 localStorage / document.cookie
           就抛 SecurityError（本机实测），框架运行时必然踩到，水合中断，照样停在骨架屏；
           而要让它真能跑就得补 allow-same-origin，那样 blob 文档与本应用同源，
           采集来的不可信脚本就能读我们的 localStorage（含登录 token）、操作父页面 DOM——这条不能给。
           结论：JS 渲染的站点在站内预览里看不到正文是架构决定的，正文请看 content_path 那个 txt，
           要看原貌走「原始地址 ↗」。 -->
      <iframe v-else-if="kind === 'html' && htmlSrc" class="fp-frame" data-testid="file-preview-html" :src="htmlSrc" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" title="HTML 预览" />
      <img v-else-if="kind === 'image' && blobUrl" class="fp-img" data-testid="file-preview-image" :src="blobUrl" :alt="name || '图片预览'" />
      <div v-else-if="kind === 'text'" class="fp-text" data-testid="file-preview-text">
        <div v-if="truncated" class="fp-hint">内容较长，仅显示前 2 MB</div>
        <pre>{{ text }}</pre>
      </div>
    </template>

    <!-- 两条退路始终在：预览失败、类型不支持、或用户就是想拿原件时都用得上。
         下载走同源 OSS 地址（<a download> 是导航，不受同源读取限制）；
         「原始地址」走 K2，指向源站，仅新窗口打开。 -->
    <div v-if="path || externalUrl" class="fp-foot">
      <a v-if="path" class="rc-btn" :href="`/oss/api/oss/download?fileId=${path}`" :download="name || ''" data-testid="file-preview-download">下载</a>
      <!-- 兜底：生产若是 https，页面里嵌 http 的 iframe 会被混合内容策略拦掉（弹窗空白），
           但新窗口打开是顶级导航，不受这条限制——留着这个按钮，那种情况下不至于卡死。 -->
      <a v-if="htmlSrc" class="rc-btn" :href="htmlSrc" target="_blank" rel="noopener noreferrer" data-testid="file-preview-open-window">新窗口打开 ↗</a>
      <a v-if="externalUrl" class="rc-btn" :href="externalUrl" target="_blank" rel="noopener noreferrer" data-testid="file-preview-external">原始地址 ↗</a>
    </div>
  </div>
</template>

<style scoped>
/* 采集被拦：说明块而不是错误块——用中性的琥珀色，不要红。红色会读成"系统出错了"，
   而这里要传达的是"数据没采到"，两者归因完全不同。 */
.fp-blocked { flex: 1; min-height: 200px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 28px 24px; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fffdf7; text-align: center; }
.fp-blocked-title { font-size: 14px; font-weight: 700; color: #92400e; margin-bottom: 8px; }
.fp-blocked-body { margin: 0 auto 6px; max-width: 46em; font-size: 12.5px; color: var(--rc-text-2); line-height: 1.7; }
.fp-blocked-body.muted { color: var(--rc-faint); }
.fp-blocked-quote { margin: 10px 0; max-width: 46em; padding: 8px 12px; border-left: 3px solid #fbbf24; background: #fffbeb; color: #92400e; font-size: 12px; text-align: left; word-break: break-all; }

.fp-wrap { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.fp-hint { display: flex; align-items: center; gap: 10px; padding: 14px; border-radius: 8px; background: #f8fafc; color: var(--rc-text-2); font-size: 12px; }
.fp-hint.error { background: #fef2f2; color: #b91c1c; word-break: break-all; }
/* 内容区撑满可用高度，不写死：放在预览抽屉里有 700+px 可用，放在单元格预览的 dialog 里
   则由 min-height 保底。原先一律固定 420px，在抽屉里白白空掉一大半。 */
.fp-excel, .fp-frame, .fp-text { flex: 1; min-height: 260px; }
.fp-excel { border: 1px solid var(--rc-border-soft); border-radius: 8px; overflow: hidden; }
.fp-frame { width: 100%; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.fp-img { max-width: 100%; flex: 1; min-height: 0; object-fit: contain; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.fp-text { overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.fp-text pre { margin: 0; padding: 12px; font-family: var(--rc-mono, monospace); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.fp-foot { display: flex; gap: 8px; }
.fp-foot .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; line-height: 28px; text-decoration: none; }
</style>
