<script setup lang="ts">
// 参数源编辑器（0721 会议）：加源弹窗的"参数源"面板抽出来的共用组件，三处复用——
// 1) SiteSourceSwitcher 加源弹窗（新建，可编辑）2) NodeInspector 参数配置 tab（readonly 只读摘要）
// 3) 编辑参数源弹窗（预填已有数据，可编辑）。readonly 态仍然算 joinType/共N个/预览，只是不给增删/编辑入口。
import { computed, reactive, ref, watch } from 'vue'
import { paramApi, type Param } from '@/api'
import {
  joinType, countGroupedUrls, groupMismatchWarnings, expandGroupedParameterizedUrl,
  type ParamGroupRef, type JoinType,
} from '@/utils/flow/urlParams'
import { paramValueCount, paramValuePreviewLabel } from '@/utils/flow/paramPreview'
import ParamEditorDrawer from '@/components/param/ParamEditorDrawer.vue'

export interface ParamSourceModel {
  baseUrl: string
  urlTemplate: string
  refs: ParamGroupRef[]
}

defineProps<{ readonly?: boolean }>()
const model = defineModel<ParamSourceModel>({ required: true })

const PREVIEW_LIMIT = 5
const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const GROUP_COLORS: Record<string, string> = { A: '#2563eb', B: '#16a34a', C: '#d97706', D: '#7c3aed', E: '#dc2626', F: '#0891b2' }
const KIND_LABELS: Record<Param['kind'], string> = { list: '列表', date: '日期', sequence: '序列', date_sequence: '日期序列', database: '数据库' }

const templateDirty = ref(false)
const paramDetails = reactive<Record<string, Param>>({})
const paramSamples = reactive<Record<string, string[]>>({})
const paramLoading = reactive<Record<string, boolean>>({})
const paramCandidates = ref<Param[]>([])
const paramPicker = reactive({ open: false })
const newParamDlg = reactive({ visible: false })

function defaultUrlTemplate(): string {
  if (!model.value.refs.length) return ''
  const base = model.value.baseUrl.trim()
  const segs = model.value.refs.map((ref) => `$PARAM$_${ref.paramId}`)
  return (base ? `${base}-` : '') + segs.join('-')
}
function regenerateTemplate() {
  templateDirty.value = false
  model.value.urlTemplate = defaultUrlTemplate()
}
function onBaseUrlInput() {
  if (!templateDirty.value) model.value.urlTemplate = defaultUrlTemplate()
}
function onUrlTemplateInput() {
  templateDirty.value = true
}

async function loadParamCandidates() {
  paramCandidates.value = (await paramApi.paramPaged({ size: 100 })).list
}
async function ensureParamLoaded(paramId: string) {
  if (paramDetails[paramId] || paramLoading[paramId]) return
  paramLoading[paramId] = true
  try {
    const [detail, values] = await Promise.all([paramApi.paramDetail(paramId), paramApi.genValues(paramId)])
    if (detail) paramDetails[paramId] = detail
    paramSamples[paramId] = values
  } finally {
    paramLoading[paramId] = false
  }
}
// 预填场景（编辑态/只读摘要）：model 一进来就带着已有 refs，需要立即补详情，不能等用户去点"选择已有参数"
watch(() => model.value.refs.map((ref) => ref.paramId).join(','), () => {
  model.value.refs.forEach((ref) => ensureParamLoaded(ref.paramId))
}, { immediate: true })

function openParamPicker() {
  paramPicker.open = !paramPicker.open
  if (paramPicker.open) loadParamCandidates()
}
function closePicker() {
  paramPicker.open = false
}
function addParamRef(paramId: string) {
  if (model.value.refs.some((ref) => ref.paramId === paramId)) return
  model.value.refs.push({ paramId, group: null })
  ensureParamLoaded(paramId)
  if (!templateDirty.value) model.value.urlTemplate = defaultUrlTemplate()
}
function removeParamRef(paramId: string) {
  model.value.refs = model.value.refs.filter((ref) => ref.paramId !== paramId)
  if (!templateDirty.value) model.value.urlTemplate = defaultUrlTemplate()
}
function usedGroups(): string[] {
  return [...new Set(model.value.refs.map((ref) => ref.group).filter((g): g is string => !!g))].sort()
}
function nextGroupLetter(): string | null {
  const used = new Set(usedGroups())
  return GROUP_LETTERS.find((letter) => !used.has(letter)) ?? null
}
function groupLimitReached(): boolean {
  return nextGroupLetter() === null
}
function onGroupChange(ref: ParamGroupRef, value: string) {
  ref.group = value === '__new' ? nextGroupLetter() : (value || null)
}
function onParamCreated(param: Param) {
  paramDetails[param.paramId] = param
  paramSamples[param.paramId] = param.values ?? []
  ensureParamLoaded(param.paramId)
  addParamRef(param.paramId)
  loadParamCandidates()
}
function paramMetaLabel(paramId: string): string {
  if (paramLoading[paramId]) return '查询中…'
  const detail = paramDetails[paramId]
  if (!detail) return '—'
  return `${KIND_LABELS[detail.kind]} · ${paramValuePreviewLabel(detail, paramSamples[paramId] ?? [])}`
}

// review 0723 #6：详情/取值还没查回来时不能直接 fallback 到 0（paramSamples 未加载时 length 是 0），
// 会导致 totalCount/预览在加载完成的瞬间从假数字跳到真实值；这里显式用 null 表示"还不知道"。
const countOf = computed<Record<string, number | null>>(() => {
  const out: Record<string, number | null> = {}
  for (const ref of model.value.refs) {
    if (paramLoading[ref.paramId]) {
      out[ref.paramId] = null
      continue
    }
    const detail = paramDetails[ref.paramId]
    out[ref.paramId] = detail ? paramValueCount(detail) : null
  }
  return out
})
const countsReady = computed(() => Object.values(countOf.value).every((v) => v !== null))
const joinTypeValue = computed<JoinType>(() => joinType(model.value.refs))
const joinTypeLabel = computed(() => ({ cartesian: '笛卡尔积', zip: '顺序', grouped: '分组顺序 + 组间笛卡尔积' } as const)[joinTypeValue.value])
const totalCount = computed(() => (countsReady.value ? countGroupedUrls(model.value.refs, countOf.value as Record<string, number>) : null))
const mismatchWarnings = computed(() => (countsReady.value ? groupMismatchWarnings(model.value.refs, countOf.value as Record<string, number>) : []))
const mismatchText = computed(() => mismatchWarnings.value
  .map((w) => `组${w.group}：同组参数值数需一致（${w.paramIds.map((id) => `「${paramDetails[id]?.name ?? id}」${countOf.value[id] ?? 0}`).join(' / ')}），计数暂按最大值对齐`)
  .join('；'))
const previewExamples = computed<string[]>(() => {
  if (!model.value.refs.length || !model.value.urlTemplate.trim() || !countsReady.value) return []
  const valuesByParam: Record<string, string[]> = {}
  for (const ref of model.value.refs) valuesByParam[ref.paramId] = paramSamples[ref.paramId] ?? []
  return expandGroupedParameterizedUrl(model.value.urlTemplate, model.value.refs, valuesByParam, PREVIEW_LIMIT).urls
})
const previewSample = computed(() => previewExamples.value[0] ?? '')

defineExpose({ totalCount, mismatchWarnings, joinTypeLabel, previewExamples, previewSample, closePicker })
</script>

<template>
  <div class="pse">
    <template v-if="!readonly">
      <input
        v-model="model.baseUrl"
        class="ssw-add-input ssw-mono"
        placeholder="基础 url，如 http://FundComment-2017052400023003000000000013026"
        @input="onBaseUrlInput"
      />
      <div class="ssw-add-hint" style="margin-top: -4px">基础 url 只填基础地址，不含参数占位符。</div>
    </template>

    <div class="ssw-sec-label">参数列表</div>
    <div class="ssw-param-table">
      <div class="ssw-param-row head">
        <span class="pn">参数名 / 占位符</span><span class="pm">类型 · 取值预览</span><span class="pg">所属组</span><span v-if="!readonly" class="pd" />
      </div>
      <div v-for="ref in model.refs" :key="ref.paramId" class="ssw-param-row">
        <span class="pn">
          <b :title="paramDetails[ref.paramId]?.name">{{ paramDetails[ref.paramId]?.name ?? ref.paramId }}</b>
          <span class="pid">$PARAM$_{{ ref.paramId }}</span>
        </span>
        <span class="pm" :title="paramMetaLabel(ref.paramId)">{{ paramMetaLabel(ref.paramId) }}</span>
        <span class="pg">
          <span class="ssw-group-chip" :class="{ none: !ref.group }" :style="ref.group ? { background: GROUP_COLORS[ref.group] } : {}">{{ ref.group ? `组${ref.group}` : '无组' }}</span>
          <select v-if="!readonly" class="ssw-group-select" :value="ref.group ?? ''" @change="onGroupChange(ref, ($event.target as HTMLSelectElement).value)">
            <option value="">无组</option>
            <option v-for="g in usedGroups()" :key="g" :value="g">组{{ g }}</option>
            <option v-if="nextGroupLetter()" value="__new">＋ 新建组</option>
          </select>
        </span>
        <span v-if="!readonly" class="pd"><button type="button" class="ssw-text-btn danger" @click="removeParamRef(ref.paramId)">删除</button></span>
      </div>
      <div v-if="!model.refs.length" class="ssw-param-empty">{{ readonly ? '暂无参数' : '暂无参数，请从下方"选择已有参数"或"新建参数"添加' }}</div>
    </div>

    <template v-if="!readonly">
      <div class="ssw-param-actions">
        <button class="rc-btn sm" type="button" data-testid="param-source-pick" @click.stop="openParamPicker">＋ 选择已有参数</button>
        <button class="rc-btn sm" type="button" data-testid="param-source-new" @click="newParamDlg.visible = true">＋ 新建参数</button>
        <div v-if="paramPicker.open" class="ssw-picker-pop" @click.stop>
          <div class="ssw-picker-title">选择已有参数（点击添加并绑定到本源）</div>
          <button
            v-for="c in paramCandidates"
            :key="c.paramId"
            type="button"
            class="ssw-picker-item"
            :class="{ added: model.refs.some((r) => r.paramId === c.paramId) }"
            @click="model.refs.some((r) => r.paramId === c.paramId) || addParamRef(c.paramId)"
          >
            <span><span class="pcn">{{ c.name }}</span><small>$PARAM$_{{ c.paramId }} · {{ KIND_LABELS[c.kind] }}</small></span>
            <span v-if="model.refs.some((r) => r.paramId === c.paramId)" class="tag-added">已添加</span>
          </button>
          <div v-if="!paramCandidates.length" class="ssw-picker-item ssw-picker-empty">暂无可选参数</div>
        </div>
      </div>
      <div class="ssw-add-hint">同组参数顺序拼（对齐取值）；不同组 / 无组之间笛卡尔积。点击"所属组"下拉即可编组。</div>
      <div v-if="groupLimitReached()" class="ssw-add-hint" style="color: var(--rc-warn, #d97706)">
        分组已达上限（A-F 共 6 个），如需更多请联系管理员。
      </div>
    </template>

    <div class="ssw-join-line">
      <span class="lab">拼接类型：</span><b>{{ joinTypeLabel }}</b><span class="auto">按分组自动推导</span>
    </div>

    <template v-if="!readonly">
      <div class="ssw-sec-label">拼接后预览 <span class="link" @click="regenerateTemplate">↺ 按参数重新生成</span></div>
      <input
        v-model="model.urlTemplate"
        class="ssw-add-input ssw-mono"
        data-testid="param-source-template"
        placeholder="基础url-$PARAM$_913-$PARAM$_912（添加参数后自动生成）"
        @input="onUrlTemplateInput"
      />
      <div class="ssw-add-hint" style="margin-top: -4px">模板 = 基础 url + 拼接符 + 占位符，默认拼接符 <code>-</code>，可手动编辑（如改成 <code>/</code>），预览值实时刷新。</div>
    </template>
    <template v-else>
      <div class="ssw-sec-label">拼接模板</div>
      <div class="ssw-readonly-template ssw-mono">{{ model.urlTemplate || '—' }}</div>
    </template>

    <div class="ssw-sec-label">预览值</div>
    <div class="ssw-preview-box">
      <div class="ssw-preview-sample">{{ previewSample || '—（请先添加参数）' }}</div>
      <div class="ssw-preview-count">共 <b>{{ totalCount === null ? '计算中…' : totalCount.toLocaleString('en-US') }}</b> 个 URL</div>
      <div v-if="previewExamples.length" class="ssw-preview-examples">
        <span class="ex-label">示例：</span>
        <code v-for="(u, i) in previewExamples" :key="i">{{ u }}</code>
      </div>
      <div v-if="mismatchWarnings.length" class="ssw-preview-warning">⚠ {{ mismatchText }}</div>
      <div v-if="!readonly" class="ssw-preview-note">本预览仅为示意（显示前 {{ PREVIEW_LIMIT }} 条）。参数源保存后在源列表只存 <b>1 条记录</b>，发任务时由任务层展开为全部 URL，前端不展开。</div>
    </div>

    <ParamEditorDrawer v-if="!readonly" v-model="newParamDlg.visible" @saved="onParamCreated" />
  </div>
</template>

<style scoped>
.pse { display: contents; }
.ssw-add-input { box-sizing: border-box; width: 100%; height: 32px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 0 9px; outline: none; margin-bottom: 8px; }
.ssw-add-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.ssw-mono { font-family: "SF Mono", Consolas, monospace; font-size: 11.5px; }
.ssw-add-hint { font-size: 11px; color: var(--rc-muted); line-height: 1.6; margin-bottom: 6px; }
.ssw-sec-label { font-size: 11px; font-weight: 700; color: var(--rc-muted); margin: 10px 0 6px; display: flex; align-items: center; gap: 8px; }
.ssw-sec-label::after { content: ''; flex: 1; height: 1px; background: var(--rc-border-soft); }
.ssw-sec-label .link { font-weight: 600; color: var(--rc-primary-ink); cursor: pointer; font-size: 11px; }
.ssw-sec-label .link:hover { text-decoration: underline; }
.ssw-param-table { border: 1px solid var(--rc-border); border-radius: 7px; overflow: hidden; margin-bottom: 8px; }
.ssw-param-row { display: flex; align-items: center; gap: 8px; padding: 6px 9px; font-size: 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.ssw-param-row:last-child { border-bottom: none; }
.ssw-param-row.head { background: var(--rc-bg, #f8fafc); color: var(--rc-muted); font-size: 11px; padding: 5px 9px; }
.ssw-param-row .pn { flex: 1.2; min-width: 0; }
.ssw-param-row .pn b { display: block; color: var(--rc-text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ssw-param-row .pid { font-family: "SF Mono", Consolas, monospace; font-size: 10.5px; color: var(--rc-warn, #d97706); }
.ssw-param-row .pm { flex: 1.4; min-width: 0; color: var(--rc-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ssw-param-row .pg { flex: none; display: flex; align-items: center; gap: 4px; width: 118px; }
.ssw-param-row .pd { flex: none; width: 34px; text-align: right; }
.ssw-group-chip { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 10px; color: #fff; line-height: 16px; }
.ssw-group-chip.none { background: var(--rc-border-soft); color: var(--rc-muted); border: 1px solid var(--rc-border); }
.ssw-group-select { height: 22px; font-size: 11px; border: 1px solid #dbe3ee; border-radius: 5px; color: var(--rc-text-2); background: #fff; outline: none; cursor: pointer; max-width: 78px; }
.ssw-param-empty { padding: 14px; text-align: center; color: var(--rc-muted); font-size: 11px; }
.ssw-param-actions { display: flex; gap: 6px; position: relative; margin-bottom: 4px; }
.ssw-text-btn { border: none; background: none; color: var(--rc-primary-ink); font-size: 11px; cursor: pointer; padding: 0 2px; font-family: inherit; }
.ssw-text-btn:hover { text-decoration: underline; }
.ssw-text-btn.danger { color: var(--rc-error, #dc2626); }
.ssw-picker-pop { position: absolute; bottom: 32px; left: 0; z-index: 20; width: 290px; max-height: 240px; overflow-y: auto; background: #fff; border: 1px solid #bfdbfe; border-radius: 7px; box-shadow: 0 8px 20px rgba(15, 23, 42, 0.14); }
.ssw-picker-title { padding: 7px 10px; font-size: 11px; color: var(--rc-muted); background: var(--rc-bg, #f8fafc); border-bottom: 1px solid var(--rc-border-soft); }
.ssw-picker-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 6px 10px; cursor: pointer; font-size: 12px; border: 0; border-bottom: 1px solid var(--rc-border-soft); background: #fff; text-align: left; font-family: inherit; }
.ssw-picker-item:hover:not(.added) { background: var(--rc-primary-bg); }
.ssw-picker-item .pcn { color: var(--rc-text); font-weight: 600; display: block; }
.ssw-picker-item small { color: var(--rc-muted); font-size: 10.5px; font-family: "SF Mono", Consolas, monospace; }
.ssw-picker-item.added { opacity: 0.45; cursor: not-allowed; }
.ssw-picker-item .tag-added { font-size: 11px; color: var(--rc-ok, #16a34a); flex: none; }
.ssw-picker-empty { cursor: default; color: var(--rc-muted); justify-content: center; }
.ssw-join-line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--rc-text-2); margin-bottom: 8px; }
.ssw-join-line .lab { color: var(--rc-muted); }
.ssw-join-line b { color: var(--rc-text); }
.ssw-join-line .auto { font-size: 10px; color: var(--rc-primary-ink); background: var(--rc-primary-bg); border: 1px solid #bfdbfe; border-radius: 4px; padding: 0 6px; line-height: 16px; }
.ssw-readonly-template { font-size: 11.5px; color: var(--rc-text-2); background: var(--rc-bg, #f8fafc); border: 1px solid var(--rc-border-soft); border-radius: 7px; padding: 6px 9px; word-break: break-all; margin-bottom: 8px; }
.ssw-preview-box { border: 1px solid #bfdbfe; background: var(--rc-primary-bg); border-radius: 7px; padding: 10px 11px; margin-bottom: 4px; }
.ssw-preview-sample { font-family: "SF Mono", Consolas, monospace; font-size: 11.5px; color: var(--rc-text); background: #fff; border: 1px solid #dbeafe; border-radius: 5px; padding: 6px 9px; word-break: break-all; line-height: 1.6; }
.ssw-preview-count { margin-top: 7px; font-size: 12px; color: var(--rc-text-2); }
.ssw-preview-count b { color: var(--rc-warn, #d97706); font-size: 15px; margin: 0 3px; }
.ssw-preview-examples { margin-top: 7px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ssw-preview-examples .ex-label { font-size: 10.5px; color: var(--rc-muted); }
.ssw-preview-examples code { background: #fff; border: 1px solid #dbeafe; border-radius: 4px; padding: 1px 6px; font-size: 10.5px; color: var(--rc-text-2); word-break: break-all; }
.ssw-preview-warning { margin-top: 7px; display: flex; gap: 5px; align-items: flex-start; background: var(--rc-error-bg, #fef2f2); border: 1px solid #fecaca; color: var(--rc-error, #dc2626); border-radius: 5px; padding: 6px 9px; font-size: 11px; line-height: 1.6; }
</style>
