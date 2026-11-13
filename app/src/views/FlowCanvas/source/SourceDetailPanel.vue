<script setup lang="ts">
// 左下角「源详情」区块：源名称 / 源 ID / 源 URL + 「编辑」入口（打开 EditSourceDialog）。
//
// 2026-11-09：从 SiteSourceSwitcher.vue 的「源详情」区块（2026-09-01 01c7373 起）抽出来复用。
// 背景：2026-11-05 aff515f 把 FlowCanvas 左栏换成「本次搜索结果」后，搜索路径上不再渲染
// SiteSourceSwitcher，用户反馈「左下角的源编辑没了」——搜索结果侧栏需要同一块。
// 现在站点侧栏（SiteSourceSwitcher）也改用本组件，两边视觉、data-testid 与点击行为一致：
// 站点侧栏传 default-expanded=false（沿用原「默认收起」），搜索结果侧栏默认展开。
import { ref } from 'vue'
import { type Source } from '@/api'
import { toExternalHref } from '@/utils/url/externalUrl'
import { copyToClipboard } from '@/utils/clipboard'
import EditSourceDialog from './EditSourceDialog.vue'

// 注意：boolean 类型的 prop 缺省会按 false 传进来，所以这里显式给默认值 true
const props = withDefaults(defineProps<{ source: Source | null; defaultExpanded?: boolean }>(), {
  defaultExpanded: true,
})
const emit = defineEmits<{ edited: [Source] }>()

const detailExpanded = ref(props.defaultExpanded !== false)
const editOpen = ref(false)

/** 复制走全站统一的 `copyToClipboard`（2026-09-22 修）：异步 API → execCommand 兜底 → 手动复制弹窗。 */
function copyText(text: string, label: string) {
  void copyToClipboard(text, label)
}
function copyId(id: string) {
  copyText(id, '源 ID')
}
/** 参数源展示 urlTemplate（带 $PARAM$ 占位符），不是能打开的地址——与站点侧栏同口径。 */
function sourceDisplayUrl(s: Source) {
  return s.kind === 'param' ? (s.urlTemplate || s.baseUrl || s.url || '') : (s.url || '')
}
function sourceOpenUrl(s: Source) {
  return s.kind === 'param' ? '' : toExternalHref(s.url)
}
function copySourceUrl(s: Source) {
  copyText(sourceDisplayUrl(s), '源 URL')
}
/** EditSourceDialog 只在保存成功后才 emit saved，这里原样抛给父级去同步列表/页签。 */
function onSaved(updated: Source) {
  editOpen.value = false
  emit('edited', updated)
}
</script>

<template>
  <div v-if="source" class="sdp-wrap">
    <div class="sdp-header" @click="detailExpanded = !detailExpanded">
      <span class="sdp-title">源详情</span>
      <span class="sdp-head-right">
        <button
          class="sdp-btn"
          type="button"
          data-testid="edit-source"
          title="编辑源名称和源 URL"
          @click.stop="editOpen = true"
        >编辑</button>
        <span class="sdp-icon">{{ detailExpanded ? '▼' : '▶' }}</span>
      </span>
    </div>
    <div v-if="detailExpanded" class="sdp-detail" data-testid="active-source-detail">
      <div class="sdp-field">
        <span class="sdp-label">源名称</span>
        <div class="sdp-val name" data-testid="active-source-full-name">{{ source.name }}</div>
      </div>
      <div class="sdp-field">
        <span class="sdp-label">源 ID</span>
        <div class="sdp-val with-copy">
          <code data-testid="active-source-full-id">{{ source.sourceId }}</code>
          <button class="sdp-btn" type="button" title="复制源 ID" @click="copyId(source.sourceId)">复制</button>
        </div>
      </div>
      <div class="sdp-field">
        <span class="sdp-label">源 URL</span>
        <div class="sdp-val with-copy">
          <el-tooltip
            v-if="sourceDisplayUrl(source)"
            :content="sourceDisplayUrl(source)"
            placement="top-start"
            :show-after="120"
            popper-class="rc-tip-longtext"
          >
            <a
              v-if="sourceOpenUrl(source)"
              class="sdp-url sdp-link"
              :href="sourceOpenUrl(source)"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="active-source-url"
            >{{ sourceDisplayUrl(source) }}</a>
            <span v-else class="sdp-url" data-testid="active-source-url">{{ sourceDisplayUrl(source) }}</span>
          </el-tooltip>
          <span v-else class="sdp-url" data-testid="active-source-url">—</span>
          <button
            class="sdp-btn"
            type="button"
            data-testid="copy-source-url"
            title="复制源 URL"
            :disabled="!sourceDisplayUrl(source)"
            @click="copySourceUrl(source)"
          >复制</button>
        </div>
      </div>
    </div>
    <EditSourceDialog
      :open="editOpen"
      :source="source"
      @update:open="editOpen = $event"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
.sdp-wrap { flex: none; }
.sdp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 9px;
  margin: 6px 6px 0;
  border: 1px solid var(--rc-border-soft);
  border-radius: 6px;
  background: #f1f5f9;
  color: var(--rc-text-2);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
  transition: background .12s, color .12s;
}
.sdp-header:hover { background: #e2e8f0; color: var(--rc-text); }
.sdp-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sdp-head-right { display: flex; align-items: center; gap: 6px; }
.sdp-icon { font-size: 9px; color: var(--rc-muted); }
.sdp-detail {
  margin: 0 6px 6px;
  padding: 8px 9px;
  border: 1px solid var(--rc-border-soft);
  border-top: none;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  background: #fff;
  font-size: 11px;
}
.sdp-field { margin-bottom: 6px; }
.sdp-field:last-child { margin-bottom: 0; }
.sdp-label { display: block; margin-bottom: 2px; font-size: 10px; font-weight: 600; color: var(--rc-muted); }
.sdp-val.name { color: var(--rc-text); font-weight: 600; line-height: 1.35; word-break: break-all; }
.sdp-val.with-copy { display: flex; align-items: flex-start; justify-content: space-between; gap: 4px; }
.sdp-val.with-copy code {
  flex: 1;
  min-width: 0;
  padding: 2px 5px;
  border-radius: 4px;
  background: #eff6ff;
  color: #2563eb;
  font-family: monospace;
  font-size: 10px;
  word-break: break-all;
}
/* 封顶 3 行：长 URL 会把下面的「回到搜索列表」顶出可视区；全文靠 el-tooltip 悬浮看 */
.sdp-url {
  flex: 1;
  min-width: 0;
  color: var(--rc-faint);
  font-size: 10px;
  line-height: 1.35;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
a.sdp-url.sdp-link { color: var(--rc-primary); text-decoration: none; }
a.sdp-url.sdp-link:hover { text-decoration: underline; }
.sdp-btn {
  flex: none;
  padding: 1px 6px;
  border: 1px solid var(--rc-border);
  border-radius: 4px;
  background: #f8fafc;
  color: var(--rc-text-2);
  font-size: 10px;
  cursor: pointer;
}
.sdp-btn:hover:not(:disabled) { background: #eff6ff; border-color: #93c5fd; color: var(--rc-primary-ink); }
.sdp-btn:disabled { opacity: .45; cursor: not-allowed; }
</style>