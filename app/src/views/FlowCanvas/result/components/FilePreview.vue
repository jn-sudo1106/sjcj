<script setup lang="ts">
// 原始文件站内预览（0819 N2-1/N2-2，会议 15:21"他其实现在是没有预览的，我们是需要新做一个预览"）。
// 2026-09-23 加音频 / 视频（<audio>/<video>，同样先取 blob，见 load() 里的说明）。
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
import { extFromName, fetchOssFile, fetchOssFileHead, mimeTypeOf, ossFileUrl, ossPathWithExt, ossPublicUrl, previewKindOf, type PreviewKind } from '@/utils/ossFile'
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
  /**
   * **未补后缀的**原始路径（0920-02）。调用方给了它，就等于说"`path` 上那个后缀是猜的"
   * ——库里存的值本身没有后缀（B22：落库时被截成了裸 md5）。
   *
   * 只有这时才给 TXT / HTML 切换：同一个 md5 下两份对象都在
   * （2026-09-21 实测公众号 `…/3e19f177…721e`：`.txt` 2750 字节、与 K13「正文大小」一致；
   * `.html` 17612 字节的网页快照），而猜中一个之后另一份用户没有任何入口能看到。
   *
   * 路径本身带后缀的（文件资源表的 K3 基本都带）不要传这个 prop，切换不出现，行为一如从前。
   */
  basePath?: string | null
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
/** 可切的后缀。写死两个：同 md5 下实测并存的就是这两种，`.md` 之类一律 404（2026-09-21 实测），
 *  探它们只是白打请求。 */
const EXT_OPTIONS = ['txt', 'html'] as const

const hintedExt = computed(() => props.ext || extFromName(props.name))
/** 用户切过才有值；空 = 跟着调用方猜的那个走 */
const pickedExt = ref('')
/** 路径是"裸的"（调用方给了 basePath 且它确实没后缀）才给切换 */
const switchable = computed(() => !!props.basePath && !extFromName(props.basePath))
const effectiveExt = computed(() => pickedExt.value || hintedExt.value)
/** 真正在看的那个文件：切过就按 basePath 重拼，没切过就用调用方给的 path */
const currentPath = computed(() => (
  switchable.value && pickedExt.value ? ossPathWithExt(String(props.basePath), pickedExt.value) : (props.path || '')
))
/** 下载名跟着切：不然切到 HTML 还会存成 `….txt` 的文件名 */
const downloadName = computed(() => (
  switchable.value ? (currentPath.value.split('/').pop() || props.name || '') : (props.name || '')
))
const kind = computed<PreviewKind>(() => previewKindOf(effectiveExt.value))

/**
 * 用户是**主动切过来看快照**的（不是这条数据只有 html）。
 * 这时"抓砸了"那套文案会说错话：2026-09-21 实测，公众号快照 17KB、可见文本只有 139 字，
 * 判定成「采集时被对方站点拦下」——可正文明明抓到了，就在旁边那份 .txt 里（2750 字节）。
 * 公众号这类页面的正文是脚本渲染的，静态存档里本来就只有框架。
 */
const snapshotMode = computed(() => switchable.value && !!pickedExt.value && kind.value === 'html')

const switching = ref(false)
/** 「这条没有 HTML 快照」这类就地提示，切成功就清掉 */
const switchNote = ref('')
/**
 * 切后缀。
 *
 * **切到 html 必须先探一次**：html 不走 fetch，是 iframe 直连 9102 那个独立 origin
 * （见本文件顶部），跨源加载失败前端收不到任何信号，切过去只会是一个白框。
 * 同源 `/oss` 探一个字节就够——OSS 对不存在的对象回干净的 404（2026-09-21 实测）。
 * 切回 txt 不用探：那条路本来就 fetch，失败会落到现有的 error 分支。
 */
async function switchExt(ext: string) {
  if (switching.value || ext === effectiveExt.value) return
  const nextPath = ossPathWithExt(String(props.basePath ?? ''), ext)
  if (!nextPath) return
  if (previewKindOf(ext) === 'html') {
    switching.value = true
    try {
      await fetchOssFileHead(nextPath, 1)
    } catch {
      switchNote.value = '这条没有 HTML 快照'
      return
    } finally {
      switching.value = false
    }
  }
  switchNote.value = ''
  pickedExt.value = ext
}
const sizeNum = computed(() => {
  const n = Number(props.size)
  return Number.isFinite(n) && n > 0 ? n : 0
})
const oversize = computed(() => sizeNum.value > AUTO_LOAD_LIMIT)
/** html 走 OSS 独立 origin 的绝对地址，不经 fetch，也不受体积上限约束（浏览器自己流式加载）。 */
const htmlSrc = computed(() => (kind.value === 'html' && currentPath.value ? ossPublicUrl(currentPath.value) : ''))
/** 任何带有效 OSS 路径的文件（含 K17 html、K6 正文 txt 等）均提供独立端口直连地址，供「新窗口打开」 */
const publicFileUrl = computed(() => (currentPath.value ? ossPublicUrl(currentPath.value) : ''))

const loading = ref(false)
const error = ref('')
// 采集被拦判定（2026-09-11）：只对"体积小得不像正文"的 HTML 存档做，正常的 MB 级文章
// 一个字节都不多读。判出来是为了把话说对——见 utils/blockedArchive.ts 顶部。
const blocked = ref<BlockedArchiveVerdict | null>(null)
const forced = ref(false)
const fallbackToFrame = ref(false)
const buffer = ref<ArrayBuffer | null>(null)
const blobUrl = ref('')
const text = ref('')
const truncated = ref(false)
/** 下载进度（音视频用）：几 MB 起步，干转圈像卡死 */
const loadedBytes = ref(0)
const totalBytes = ref(0)
/** 浏览器解不了这个音视频（编码 / 容器不支持，如部分 mov、flac） */
const mediaError = ref(false)
const isMedia = computed(() => kind.value === 'audio' || kind.value === 'video')
function mb(n: number) {
  return (n / 1024 / 1024).toFixed(1)
}

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
  fallbackToFrame.value = false
  loadedBytes.value = 0
  totalBytes.value = 0
  mediaError.value = false
}

/**
 * HTML 存档的"抓砸了"探测。**只在体积粗筛命中时才发这一次请求**：
 * 正常文章 3MB 级直接跳过，渲染路径一如既往交给 iframe（0909 定案：html 不 fetch 字节，
 * 由 iframe 按 OSS 绝对地址自己加载）。这里读到的字节只用于判定，不参与渲染。
 */
async function sniffBlocked() {
  if (kind.value !== 'html' || !currentPath.value) return
  // 体积已知且明显不小时跳过：正常文章都在 MB 级，没必要探。
  // 体积未知时照样探——调用方目前并不传 size，而**只读头部**，代价就是几十 KB。
  if (sizeNum.value > BLOCKED_ARCHIVE_SIZE_LIMIT) return
  try {
    const buf = await fetchOssFileHead(currentPath.value, BLOCKED_ARCHIVE_SNIFF_BYTES)
    const verdict = detectBlockedArchive(new TextDecoder('utf-8').decode(buf))
    if (verdict.blocked) blocked.value = verdict
  } catch {
    // 探测失败不影响预览：照常渲染 iframe，退回改动前的行为
  }
}

/** 能预览、有路径、且（没超限或用户点了"仍要预览"）才真正去取。
 *  html 不在此列——它由 iframe 自己按绝对地址加载，前端不碰字节。 */
const shouldLoad = computed(() => !!currentPath.value && kind.value !== 'none' && kind.value !== 'html' && (!oversize.value || forced.value))

async function load() {
  if (!shouldLoad.value || !currentPath.value) return
  loading.value = true
  error.value = ''
  try {
    // 音视频（2026-09-23）也先取成 blob 再交给 <audio>/<video>，不能直接把 OSS 地址给播放器：
    // 实测直连 9102 播放器报 MEDIA_ERR_SRC_NOT_SUPPORTED——OSS 回的是 201（不是 200/206）、
    // 类型是 octet-stream、也不支持 Range；取成带正确 MIME 的 blob 后时长、拖动都正常。
    const buf = isMedia.value
      ? await fetchOssFile(currentPath.value, (received, total) => { loadedBytes.value = received; totalBytes.value = total })
      : await fetchOssFile(currentPath.value)
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
    // 文本或直连文件：同源 /oss 代理取字节流失败（如生产环境未配置 /oss 反代）时，平滑回退到 9102 直连框架预览
    if (kind.value === 'text' && publicFileUrl.value) {
      fallbackToFrame.value = true
    } else {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    loading.value = false
  }
}

// 换了一条数据（调用方给了新的 path / basePath）就把切换态清回默认——
// 切换是"我想再看一眼另一份"的临时动作，不该跟着下一条数据走
watch(() => [props.path, props.basePath] as const, () => {
  pickedExt.value = ''
  switchNote.value = ''
})
watch(() => [currentPath.value, props.ext, props.name] as const, () => {
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
    <!-- 0920-02：库里存的正文路径没有后缀，前端按字段语义猜了一个（正文→txt）。
         同一个 md5 下网页快照（.html）也在，猜中一个之后另一份本来没有任何入口能看到。
         只在"后缀是猜的"时出现；路径自带后缀的一概不显示。 -->
    <div v-if="switchable" class="fp-bar" data-testid="file-preview-ext-switch">
      <button
        v-for="opt in EXT_OPTIONS"
        :key="opt"
        type="button"
        class="fp-ext"
        :class="{ on: effectiveExt === opt }"
        :disabled="switching"
        :data-testid="`file-preview-ext-${opt}`"
        @click="switchExt(opt)"
      >{{ opt.toUpperCase() }}</button>
      <span v-if="switching" class="fp-bar-note">检查中…</span>
      <span v-else-if="switchNote" class="fp-bar-note" data-testid="file-preview-ext-note">{{ switchNote }}</span>
    </div>

    <div v-if="!currentPath" class="fp-hint" data-testid="file-preview-nopath">该文件未提供可访问地址，无法预览</div>

    <div v-else-if="kind === 'none' && !fallbackToFrame" class="fp-hint" data-testid="file-preview-unsupported">
      <span>该类型不支持站内直接解析（{{ ext || extFromName(name) || '未知类型' }}），可下载后查看</span>
      <button v-if="publicFileUrl" class="rc-btn" type="button" @click="fallbackToFrame = true">在框架中打开</button>
    </div>

    <div v-else-if="oversize && !forced" class="fp-hint" data-testid="file-preview-oversize">
      文件较大（{{ (sizeNum / 1024 / 1024).toFixed(1) }} MB），未自动加载
      <button class="rc-btn" type="button" @click="forced = true">仍要预览</button>
    </div>

    <div v-else-if="loading" class="fp-hint" data-testid="file-preview-loading">
      加载中…<template v-if="isMedia && totalBytes"> {{ mb(loadedBytes) }} / {{ mb(totalBytes) }} MB</template>
    </div>

    <div v-else-if="mediaError" class="fp-hint" data-testid="file-preview-media-error">
      浏览器无法播放这个文件（{{ effectiveExt || '未知格式' }}），可能是编码不受支持，可下载后用本地播放器查看
    </div>

    <div v-else-if="error && !fallbackToFrame" class="fp-hint error" data-testid="file-preview-error">
      <span>{{ error }}</span>
      <button v-if="publicFileUrl" class="rc-btn" type="button" style="margin-left: 8px" @click="fallbackToFrame = true">使用直连框架预览</button>
    </div>

    <!-- 采集时被对方站点拦下（2026-09-11）。
         **文案的主语必须是采集，不能写"无法预览"**——后者会让人以为是本系统的能力问题，
         而真正该被看见的是这条数据没抓到正文。引述存档里的原话，比我们转述更有说服力。 -->
    <div v-else-if="blocked && !forced" class="fp-blocked" data-testid="file-preview-blocked">
      <!-- 从 TXT 切过来看快照时是另一回事：正文已经抓到了，这里只是那份 html 存档没有正文。
           说成"采集被拦下"会把人引到错误的结论上（0920-02，2026-09-21 实测公众号快照）。 -->
      <template v-if="snapshotMode">
        <div class="fp-blocked-title">这份快照里没有正文</div>
        <p class="fp-blocked-body">
          存档里只有 {{ blocked.textLength }} 个字的页面框架——这类页面的正文由脚本渲染，
          静态存档里通常就是这样。<b>正文看 TXT 那一份。</b>
        </p>
      </template>
      <template v-else>
        <div class="fp-blocked-title">这条数据采集时被对方站点拦下了</div>
        <p class="fp-blocked-body">
          <template v-if="blocked.reason === 'pattern'">存档里是一张拦截/验证页，不是文章正文</template>
          <template v-else>存档里没有正文，只有 {{ blocked.textLength }} 个字的页面框架</template><template v-if="sizeNum">（仅 {{ (sizeNum / 1024).toFixed(0) }} KB，同类正文通常在 MB 级）</template>。
        </p>
      </template>
      <!-- 只有真从**可见文本**里认出拦截提示时才引述；否则没有原话可引，
           硬引会引出「视频 小程序 赞」这类页脚碎词（2026-09-11 实测踩过）。 -->
      <p v-if="!snapshotMode && blocked.reason === 'pattern' && blocked.hint" class="fp-blocked-quote">「{{ blocked.hint }}」</p>
      <p v-if="!snapshotMode" class="fp-blocked-body muted">这不代表原文打不开——原文多半正常，只是这次没采到。</p>
      <button class="rc-btn" type="button" style="margin-top: 10px" @click="forced = true">仍要预览页面</button>
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
      <audio v-else-if="kind === 'audio' && blobUrl" class="fp-audio" data-testid="file-preview-audio" :src="blobUrl" controls preload="metadata" @error="mediaError = true" />
      <video v-else-if="kind === 'video' && blobUrl" class="fp-video" data-testid="file-preview-video" :src="blobUrl" controls preload="metadata" @error="mediaError = true" />
      <img v-else-if="kind === 'image' && blobUrl" class="fp-img" data-testid="file-preview-image" :src="blobUrl" :alt="name || '图片预览'" />
      <div v-else-if="kind === 'text' && text" class="fp-text" data-testid="file-preview-text">
        <div v-if="truncated" class="fp-hint">内容较长，仅显示前 2 MB</div>
        <pre>{{ text }}</pre>
      </div>
      <!-- 文本直连回退 / 无法同源读取时的框架直连回退（直连 9102 端口，与新窗口打开同款地址） -->
      <iframe v-else-if="(kind === 'text' || fallbackToFrame) && publicFileUrl" class="fp-frame" data-testid="file-preview-frame" :src="publicFileUrl" title="文件预览" />
    </template>

    <!-- 两条退路始终在：预览失败、类型不支持、或用户就是想拿原件时都用得上。
         下载走同源 OSS 地址（<a download> 是导航，不受同源读取限制）；
         「原始地址」走 K2，指向源站，仅新窗口打开。 -->
    <div v-if="currentPath || externalUrl" class="fp-foot">
      <a v-if="currentPath" class="rc-btn" :href="ossFileUrl(currentPath)" :download="downloadName" data-testid="file-preview-download">下载</a>
      <!-- 兜底与直连：新窗口打开为顶级导航，不受同源读取限制；K17 html 与 K6 正文文本等所有 OSS 路径均支持直接新窗口打开 -->
      <a v-if="publicFileUrl" class="rc-btn" :href="publicFileUrl" target="_blank" rel="noopener noreferrer" data-testid="file-preview-open-window">新窗口打开 ↗</a>
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
.fp-audio { width: 100%; }
.fp-video { width: 100%; flex: 1; min-height: 260px; max-height: 70vh; border-radius: 8px; background: #000; }
.fp-img { max-width: 100%; flex: 1; min-height: 0; object-fit: contain; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.fp-text { overflow: auto; border: 1px solid var(--rc-border-soft); border-radius: 8px; background: #fff; }
.fp-text pre { margin: 0; padding: 12px; font-family: var(--rc-mono, monospace); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.fp-bar { display: flex; align-items: center; gap: 6px; }
.fp-ext { height: 24px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 11px; cursor: pointer; }
.fp-ext:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary); }
.fp-ext.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 600; }
.fp-ext:disabled { cursor: progress; opacity: .6; }
.fp-bar-note { color: var(--rc-faint); font-size: 11px; }
.fp-foot { display: flex; gap: 8px; }
.fp-foot .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; line-height: 28px; text-decoration: none; }
</style>
