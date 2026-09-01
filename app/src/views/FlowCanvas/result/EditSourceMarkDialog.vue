<script setup lang="ts">
// 行内编辑一个源的标签与备注（0831 F02/F04）。
//
// 为什么单独开一个入口：批量条只能「追加」（tagSource add）和「清空」（tags 写空串），
// 会上提的「标签要能改能删」指的是**删掉三个标签里的中间那个**，追加和清空都做不到。
// 这里提交的是标签的**完整列表**，删一个就是列表里少一个。
//
// 与旧平台同源：`page/config/SourceList.vue:1520-1561` 的「备注信息」弹窗也是标签+备注
// 一起编辑、一起 updateSource 提交，字段名和 `#a,#b` 的写法都对齐。
//
// 弹窗形态跟隔壁 EditSourceDialog 一致（轻量遮罩卡片），属于"短流程编辑"，
// 符合详情弹层长期约定里"居中弹窗只用于操作型内容"的那一条。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source } from '@/api'
import { normalizeIssueTag, parseIssueTags } from '@/utils/sourceMark'

const props = defineProps<{
  source: Source
  /** 输入建议；不限制取值，用户可以敲任何标签名 */
  tagCandidates: string[]
}>()
const emit = defineEmits<{
  saved: [{ tags: string[]; remark: string }]
  close: []
}>()

const tags = ref<string[]>([...(props.source.tags ?? [])])
const remark = ref(props.source.remark ?? '')
const draft = ref('')
const saving = ref(false)

const suggestions = computed(() => props.tagCandidates.filter((tag) => !tags.value.includes(tag)).slice(0, 12))

function addTag(raw: string) {
  // 一次粘进来 "#a,#b" 也认：parseIssueTags 会拆分、去 # 、去重
  const incoming = parseIssueTags(raw).filter((tag) => !tags.value.includes(tag))
  if (!incoming.length) return
  tags.value = [...tags.value, ...incoming]
  draft.value = ''
}
function removeTag(tag: string) {
  tags.value = tags.value.filter((item) => item !== tag)
}
function onDraftEnter() {
  if (normalizeIssueTag(draft.value)) addTag(draft.value)
}
/** 输入框空着时按退格删掉最后一个标签——标签输入框的通用手感 */
function onDraftBackspace() {
  if (draft.value) return
  tags.value = tags.value.slice(0, -1)
}

async function save() {
  if (saving.value) return
  // 敲了一半没按回车就点保存的，算数——不然用户会以为标签丢了
  const pending = parseIssueTags(draft.value).filter((tag) => !tags.value.includes(tag))
  const nextTags = [...tags.value, ...pending]
  const nextRemark = remark.value.trim()
  saving.value = true
  try {
    const res = await sourceApi.updateSourceMark(props.source.sourceId, { tags: nextTags, remark: nextRemark })
    if (!res?.ok) {
      ElMessage.warning(res?.message || '保存失败，请重试')
      return
    }
    emit('saved', { tags: nextTags, remark: nextRemark })
    ElMessage.success(res.message || '已保存')
  } catch (error) {
    ElMessage.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="esm-backdrop" data-testid="edit-source-mark-dialog" @click.self="emit('close')">
    <div class="esm-card">
      <div class="esm-title">标签与备注</div>
      <div class="esm-source" :title="source.name">{{ source.sourceId }} · {{ source.name }}</div>

      <div class="rc-field">
        <label>标签</label>
        <div class="esm-box">
          <span v-for="tag in tags" :key="tag" class="esm-chip" :data-testid="`edit-mark-tag-${tag}`">
            {{ tag }}
            <button type="button" :aria-label="`删除标签 ${tag}`" :data-testid="`edit-mark-remove-${tag}`" @click="removeTag(tag)">×</button>
          </span>
          <input
            v-model="draft"
            class="esm-draft"
            aria-label="添加标签"
            data-testid="edit-mark-tag-input"
            placeholder="输入后回车添加"
            @keydown.enter.prevent="onDraftEnter"
            @keydown.backspace="onDraftBackspace"
          />
        </div>
        <div v-if="suggestions.length" class="esm-suggest">
          <button
            v-for="tag in suggestions"
            :key="tag"
            type="button"
            :data-testid="`edit-mark-suggest-${tag}`"
            @click="addTag(tag)"
          >{{ tag }}</button>
        </div>
        <div class="rc-help">提交的是完整列表，删掉的标签保存后就没了。</div>
      </div>

      <div class="rc-field">
        <label>备注</label>
        <input v-model="remark" class="rc-input" aria-label="备注" data-testid="edit-mark-remark" placeholder="如：验证正常" />
      </div>

      <div class="esm-actions">
        <button class="rc-btn" type="button" data-testid="edit-mark-cancel" @click="emit('close')">取消</button>
        <button class="rc-btn primary" type="button" data-testid="edit-mark-save" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.esm-backdrop { position: fixed; inset: 0; z-index: 91; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, .28); }
.esm-card { width: min(520px, calc(100vw - 48px)); padding: 16px; border: 1px solid var(--rc-border); border-radius: 12px; background: #fff; box-shadow: 0 24px 64px -22px rgba(15, 23, 42, .45); }
.esm-title { margin-bottom: 4px; color: var(--rc-text); font-size: 13px; font-weight: 800; }
.esm-source { overflow: hidden; margin-bottom: 12px; color: var(--rc-faint); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.esm-box { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; min-height: 34px; padding: 5px 7px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; box-sizing: border-box; }
.esm-chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 4px 0 7px; border: 1px solid #a9c2ff; border-radius: 4px; background: #edf4ff; color: var(--rc-primary); font-size: 11px; }
.esm-chip button { padding: 0 2px; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 13px; line-height: 1; }
.esm-draft { min-width: 120px; flex: 1; border: 0; outline: 0; background: transparent; color: var(--rc-text); font-size: 12px; }
.esm-suggest { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.esm-suggest button { height: 22px; padding: 0 7px; border: 1px dashed #dce5f1; border-radius: 4px; background: #f8fafc; color: var(--rc-muted); cursor: pointer; font-size: 10px; }
.esm-suggest button:hover { border-style: solid; border-color: #a9c2ff; color: var(--rc-primary); }
.esm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.rc-field { display: block; min-width: 0; height: auto; margin-bottom: 14px; padding: 0; border: 0; background: transparent; white-space: normal; }
.rc-field label { display: block; margin-bottom: 4px; color: var(--rc-muted); font-size: 11px; }
.rc-field:last-of-type { margin-bottom: 12px; }
.rc-input { width: 100%; padding: 7px 9px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; box-sizing: border-box; color: var(--rc-text); font-size: 12px; outline: none; }
.rc-help { margin-top: 6px; color: var(--rc-faint); font-size: 10px; line-height: 1.5; }
</style>
