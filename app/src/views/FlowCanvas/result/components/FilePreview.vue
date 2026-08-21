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
import { extFromName, fetchOssFile, previewKindOf, type PreviewKind } from '@/utils/ossFile'

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

const kind = computed<PreviewKind>(() => previewKindOf(props.ext || extFromName(props.name)))
const sizeNum = computed(() => {
  const n = Number(props.size)
  return Number.isFinite(n) && n > 0 ? n : 0
})
const oversize = computed(() => sizeNum.value > AUTO_LOAD_LIMIT)

const loading = ref(false)
const error = ref('')
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
}

/** 能预览、有路径、且（没超限或用户点了"仍要预览"）才真正去取 */
const shouldLoad = computed(() => !!props.path && kind.value !== 'none' && (!oversize.value || forced.value))

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
      blobUrl.value = URL.createObjectURL(new Blob([buf]))
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

    <template v-else>
      <ExcelViewer
        v-if="kind === 'excel' && buffer"
        class="fp-excel"
        data-testid="file-preview-excel"
        :src="buffer"
        @error="onExcelError"
      />
      <iframe v-else-if="kind === 'pdf' && blobUrl" class="fp-frame" data-testid="file-preview-pdf" :src="blobUrl" title="PDF 预览" />
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
      <a v-if="externalUrl" class="rc-btn" :href="externalUrl" target="_blank" rel="noopener noreferrer" data-testid="file-preview-external">原始地址 ↗</a>
    </div>
  </div>
</template>

<style scoped>
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
