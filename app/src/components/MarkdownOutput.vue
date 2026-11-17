<script setup lang="ts">
import { computed } from 'vue'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const props = withDefaults(defineProps<{ content: string; streaming?: boolean }>(), {
  streaming: false,
})
const markdown = new Marked({ gfm: true, breaks: true })
const SANITIZE_OPTIONS = {
  ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'del',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'input'],
  ALLOWED_ATTR: ['href', 'title', 'class', 'align', 'start', 'type', 'checked', 'disabled'],
  ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
}

function renderBlock(src: string): string {
  return DOMPurify.sanitize(markdown.parse(src, { async: false }), SANITIZE_OPTIONS)
}

// 按空行切块，代码围栏内的空行不切（避免把代码块拦腰截断）
function splitBlocks(text: string): string[] {
  const blocks: string[] = []
  let cur: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence
    if (!inFence && line.trim() === '' && cur.length > 0) {
      blocks.push(cur.join('\n'))
      cur = []
    } else {
      cur.push(line)
    }
  }
  if (cur.length > 0) blocks.push(cur.join('\n'))
  return blocks
}

// 流式期增量渲染：已定稿 block 命中缓存直接复用，只有最后一个未定稿 block 重解析；
// 每个 block 独立 v-html 节点，定稿节点的 DOM 不再被整体替换。
let blockCache: Array<{ src: string; html: string }> = []
const renderedBlocks = computed<string[]>(() => {
  if (!props.streaming) {
    const html = renderBlock(props.content)
    blockCache = [{ src: props.content, html }]
    return [html]
  }
  const parts = splitBlocks(props.content)
  const next = parts.map((src, i) => {
    const prev = blockCache[i]
    if (prev && prev.src === src) return prev
    return { src, html: renderBlock(src) }
  })
  blockCache = next
  return next.map((b) => b.html)
})
</script>

<template>
  <div class="markdown-output">
    <div v-for="(html, i) in renderedBlocks" :key="i" class="markdown-block" v-html="html" />
  </div>
</template>

<style scoped>
.markdown-output { padding: 16px; color: var(--el-text-color-primary); font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
.markdown-output :deep(.markdown-block > :first-child) { margin-top: 0; }.markdown-output :deep(.markdown-block > :last-child) { margin-bottom: 0; }
.markdown-output :deep(p) { margin: 0 0 12px; }.markdown-output :deep(h1), .markdown-output :deep(h2), .markdown-output :deep(h3), .markdown-output :deep(h4), .markdown-output :deep(h5), .markdown-output :deep(h6) { margin: 22px 0 10px; font-weight: 600; line-height: 1.5; }
.markdown-output :deep(h1) { font-size: 24px; }.markdown-output :deep(h2) { font-size: 21px; }.markdown-output :deep(h3) { font-size: 18px; }.markdown-output :deep(h4) { font-size: 16px; }
.markdown-output :deep(ul), .markdown-output :deep(ol) { padding-left: 24px; margin: 8px 0 14px; }.markdown-output :deep(li) { margin: 4px 0; }
.markdown-output :deep(blockquote) { margin: 12px 0; padding: 4px 14px; border-left: 3px solid var(--el-color-primary-light-5); color: var(--el-text-color-secondary); background: var(--el-fill-color-light); }
.markdown-output :deep(code) { font: 12px/1.7 Consolas, monospace; padding: 2px 5px; background: var(--el-fill-color); border-radius: 4px; white-space: pre-wrap; }
.markdown-output :deep(pre) { padding: 12px 14px; margin: 12px 0; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: var(--el-fill-color); white-space: pre-wrap; overflow-wrap: anywhere; }
.markdown-output :deep(pre code) { padding: 0; background: transparent; }
.markdown-output :deep(table) { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 12px 0; }.markdown-output :deep(th), .markdown-output :deep(td) { padding: 8px 10px; border: 1px solid var(--el-border-color); overflow-wrap: anywhere; }.markdown-output :deep(th) { background: var(--el-fill-color); font-weight: 600; }
.markdown-output :deep(hr) { border: 0; border-top: 1px solid var(--el-border-color); margin: 20px 0; }.markdown-output :deep(a) { color: var(--el-color-primary); }
.markdown-output :deep(input[type="checkbox"]) { margin-right: 6px; vertical-align: middle; accent-color: var(--el-color-primary); }
.markdown-output :deep(li.task-list-item) { list-style-type: none; margin-left: -18px; }
</style>
