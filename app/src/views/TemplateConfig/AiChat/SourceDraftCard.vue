<script setup lang="ts">
// 智能体对话建源的确认卡片：展示智能体整理的建源草稿，回查网站 / 分类 / 流程模板 / 同名源后让用户核对，
// 确认后由父级调用 executeSourceDraft 落库（逐步进度写回 SourceDraftState.steps）。
// 方案与原型：设计稿/设计方案/1120-智能体对话建源_前端与智能体Skill开发方案_2026-11-20.md、
// 设计稿/原型设计/1120-AI问数对话建源_需求原型_2026-11-20.html
import { computed, onMounted, ref, watch } from 'vue'
import { isProductionCreateEnabled } from '@/api'
import CategoryTreePicker, { type CategorySelection } from '@/views/FlowCanvas/source/CategoryTreePicker.vue'
import {
  BIZ_DIR_ROOT_ID,
  initialSourceForm,
  loadSiteSourceOptions,
  resolveSourceDraft,
  searchSites,
  validateSourceForm,
  type SourceDraftForm,
  type SourceDraftHints,
  type SourceDraftState,
  type SourceFlowMode,
  type SourceSiteMode,
} from '@/utils/aiChat/sourceDraft'

const props = withDefaults(defineProps<{
  state: SourceDraftState
  /** 对话正在流式响应时禁止确认 */
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  (e: 'confirm', form: SourceDraftForm): void
  (e: 'cancel'): void
}>()

// 失败后不可再确认：网站或部分源可能已建，重试会重复建（与手动新建一致，结果里列出已成功的 ID）
const editable = computed(() => props.state.status === 'pending')
const createEnabled = isProductionCreateEnabled()

const resolving = ref(false)
const hints = ref<SourceDraftHints | null>(null)
const form = ref<SourceDraftForm | null>(null)
const touched = ref(false)

const siteOptions = ref<Array<{ siteId: string; name: string; sourceCount: number }>>([])
const siteSearching = ref(false)
const siteSourceOptions = ref<Array<{ sourceId: string; name: string }>>([])
const siteSourceSelectOptions = computed(() =>
  siteSourceOptions.value.map((s) => ({ value: s.sourceId, label: `${s.name}（ID ${s.sourceId}）` })),
)

async function resolve() {
  resolving.value = true
  try {
    const h = await resolveSourceDraft(props.state.draft)
    hints.value = h
    form.value = initialSourceForm(props.state.draft, h)
    if (h.existingSite) siteOptions.value = [{ ...h.existingSite }]
    siteSourceOptions.value = h.siteSources
  } finally {
    resolving.value = false
  }
}

onMounted(() => {
  if (editable.value) void resolve()
})
watch(() => props.state.draft, () => {
  touched.value = false
  if (editable.value) void resolve()
})

const errors = computed(() => (form.value ? validateSourceForm(form.value) : []))

const category = computed<CategorySelection>({
  get: () => ({ dirId: form.value?.dirId, category: form.value?.category ?? '', categoryPath: form.value?.categoryPath ?? '' }),
  set: (v) => {
    if (!form.value) return
    form.value.dirId = v.dirId ?? ''
    form.value.category = v.category
    form.value.categoryPath = v.categoryPath
  },
})

const categoryHint = computed(() => {
  const want = props.state.draft.category
  if (!want || !form.value) return null
  return hints.value?.matchedCategory ? { ok: true, text: `已按「${want}」匹配` } : { ok: false, text: `未匹配到「${want}」，请选择` }
})

const templateHint = computed(() => {
  const want = props.state.draft.flowTemplate
  if (!want) return null
  return hints.value?.matchedTemplateId ? { ok: true, text: '已按智能体建议预选' } : { ok: false, text: `未找到模板「${want}」` }
})

function setSiteMode(mode: SourceSiteMode) {
  if (!form.value) return
  form.value.siteMode = mode
  if (mode === 'existing' && !form.value.siteId && hints.value?.existingSite) {
    form.value.siteId = hints.value.existingSite.siteId
    form.value.siteName = hints.value.existingSite.name
  }
  if (mode === 'new' && !form.value.siteName) form.value.siteName = props.state.draft.siteName
  if (mode !== 'existing' && form.value.flowMode === 'copy') form.value.flowMode = form.value.templateId ? 'template' : 'none'
}

async function onSiteSearch(keyword: string) {
  if (!keyword.trim()) return
  siteSearching.value = true
  try {
    siteOptions.value = await searchSites(keyword)
  } catch {
    siteOptions.value = []
  } finally {
    siteSearching.value = false
  }
}

async function onSitePicked(siteId: string) {
  if (!form.value) return
  const site = siteOptions.value.find((s) => s.siteId === siteId)
  form.value.siteName = site?.name ?? ''
  form.value.templateSourceId = ''
  form.value.templateSourceName = ''
  try {
    siteSourceOptions.value = await loadSiteSourceOptions(siteId)
  } catch {
    siteSourceOptions.value = []
  }
  const first = siteSourceOptions.value[0]
  if (first) {
    form.value.templateSourceId = first.sourceId
    form.value.templateSourceName = first.name
  } else if (form.value.flowMode === 'copy') {
    form.value.flowMode = form.value.templateId ? 'template' : 'none'
  }
}

function onTemplatePicked(id: string) {
  if (!form.value) return
  form.value.templateName = hints.value?.templates.find((t) => t.id === id)?.name ?? ''
}

function onTemplateSourcePicked(id: string) {
  if (!form.value) return
  form.value.templateSourceName = siteSourceOptions.value.find((s) => s.sourceId === id)?.name ?? ''
}

const flowModeOptions = computed<Array<{ value: SourceFlowMode; label: string }>>(() => {
  const opts: Array<{ value: SourceFlowMode; label: string }> = []
  if (form.value?.siteMode === 'existing') opts.push({ value: 'copy', label: '复制参考源的流程' })
  opts.push({ value: 'template', label: '按流程模板新建' }, { value: 'none', label: '暂不建流程' })
  return opts
})

const flowModeText = computed(() => {
  const f = form.value
  if (!f) return ''
  if (f.flowMode === 'none') return '不建流程：源建好后进画布为空，用流程标签栏「＋」新建（届时仍要选模板）'
  if (f.flowMode === 'copy') return '每个源复制参考源的默认流程，独立一份、含配置（同网站详情「添加源 → 按模板源」）'
  if (f.siteMode === 'new') return '同批源共用一条流程，名称 = 网站名（同「新建采集」）'
  if (f.siteMode === 'existing') return '每个源各建一条流程（同网站详情「添加源」）'
  return '每个源各建一条流程，名称 = 源名'
})

function addSource() {
  form.value?.sources.push({ name: '', url: '' })
}
function removeSource(i: number) {
  form.value?.sources.splice(i, 1)
}

function onConfirm() {
  touched.value = true
  if (!form.value || errors.value.length || props.disabled || !createEnabled) return
  emit('confirm', JSON.parse(JSON.stringify(form.value)) as SourceDraftForm)
}

const stepIcon: Record<string, string> = { done: '✓', failed: '✗', running: '●', skipped: '–' }
const result = computed(() => props.state.result)
const canvasLink = computed(() => {
  const r = result.value
  const first = r?.sources[0]?.sourceId
  if (!first) return null
  return { path: '/canvas', query: { ...(r?.siteId ? { siteId: r.siteId } : {}), sourceId: first, view: 'flow' } }
})

/** 历史回放没有执行结果对象，只有回传文本（formatSourceCreatedMessage）：从中取第一个源 ID / 网站 ID 进画布 */
const replayCanvasLink = computed(() => {
  const text = props.state.resultText || ''
  const sourceId = text.match(/源 ID (\d+)/)?.[1]
  if (!sourceId) return null
  const siteId = text.match(/网站 ID (\d+)/)?.[1]
  return { path: '/canvas', query: { ...(siteId ? { siteId } : {}), sourceId, view: 'flow' } }
})
</script>

<template>
  <div class="sd-card" :class="state.status" data-testid="source-draft-card">
    <div class="sd-head">
      <span class="sd-title"><span class="sd-dot" />建源草稿</span>
      <span v-if="state.status === 'pending'" class="sd-hint">核对后点「确认创建」才会真正建源，可直接修改</span>
      <span v-else-if="state.status === 'creating'" class="sd-hint">正在创建…</span>
      <span v-else-if="state.status === 'created'" class="sd-status ok" data-testid="source-draft-created">已创建</span>
      <span v-else-if="state.status === 'failed'" class="sd-status err">未全部完成，已停止</span>
      <span v-else class="sd-status muted">已取消</span>
    </div>

    <div v-if="state.draft.remark" class="sd-note"><b>智能体提醒：</b>{{ state.draft.remark }}</div>

    <!-- 历史回放：草稿已确认过，只展示回传的结果，不再回查、不可再确认 -->
    <template v-if="!editable && !state.steps && state.resultText">
      <div class="sd-note" data-testid="source-draft-replay">{{ state.resultText }}</div>
      <div v-if="replayCanvasLink" class="sd-result">
        <router-link :to="replayCanvasLink" class="sd-canvas-btn" data-testid="source-draft-canvas">
          进入画布配置采集
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
          </svg>
        </router-link>
      </div>
    </template>

    <div v-if="editable && resolving" class="sd-loading">正在回查网站、分类与流程模板…</div>

    <template v-if="form && (editable || state.steps)">
      <div class="sd-sec">
        <div class="sd-sec-t">网站</div>
        <div class="sd-grid">
          <div class="sd-field">
            <span>建到</span>
            <el-radio-group :model-value="form.siteMode" size="small" :disabled="!editable" data-testid="source-draft-site-mode" @change="(v: string | number | boolean | undefined) => setSiteMode(v as SourceSiteMode)">
              <el-radio-button value="new">新建网站</el-radio-button>
              <el-radio-button value="existing">加到已有网站</el-radio-button>
              <el-radio-button value="none">不关联网站</el-radio-button>
            </el-radio-group>
          </div>

          <label v-if="form.siteMode === 'new'" class="sd-field">
            <span>网站名称<em v-if="state.draft.siteName && !hints?.existingSite" class="sd-tag warn">库中没有同名网站</em></span>
            <el-input v-model="form.siteName" size="small" :disabled="!editable" data-testid="source-draft-site-name" />
          </label>
          <div v-else-if="form.siteMode === 'existing'" class="sd-field">
            <span>网站<em v-if="hints?.existingSite && form.siteId === hints.existingSite.siteId" class="sd-tag ok">库中已有同名网站 · ID {{ hints.existingSite.siteId }}</em></span>
            <el-select
              v-model="form.siteId"
              size="small"
              filterable
              remote
              :remote-method="onSiteSearch"
              :loading="siteSearching"
              placeholder="输入网站名搜索"
              :disabled="!editable"
              data-testid="source-draft-site-select"
              @change="onSitePicked"
            >
              <el-option v-for="s in siteOptions" :key="s.siteId" :label="`${s.name}（ID ${s.siteId}）`" :value="s.siteId" />
            </el-select>
          </div>
          <div v-else class="sd-field">
            <span>网站</span>
            <div class="sd-readonly">不归属网站（源列表按「未关联网站」可筛出，之后可用网站「批量导入 → 关联已有源」挂上）</div>
          </div>

          <div v-if="form.siteMode !== 'existing'" class="sd-field">
            <span>
              业务分类{{ form.siteMode === 'none' ? '（源的业务目录）' : '' }}
              <em v-if="categoryHint" class="sd-tag" :class="categoryHint.ok ? 'ok' : 'warn'">{{ categoryHint.text }}</em>
            </span>
            <CategoryTreePicker
              v-if="editable"
              v-model="category"
              :root-id="BIZ_DIR_ROOT_ID"
              :auto-select-first="false"
              data-testid="source-draft-category"
            />
            <div v-else class="sd-readonly">{{ form.category || form.categoryPath || '—' }}</div>
          </div>
        </div>
      </div>

      <div class="sd-sec">
        <div class="sd-sec-t">流程</div>
        <div class="sd-grid">
          <div class="sd-field">
            <span>流程方式</span>
            <el-radio-group v-model="form.flowMode" size="small" :disabled="!editable" data-testid="source-draft-flow-mode">
              <el-radio-button v-for="o in flowModeOptions" :key="o.value" :value="o.value">{{ o.label }}</el-radio-button>
            </el-radio-group>
          </div>
          <label v-if="form.flowMode === 'template'" class="sd-field">
            <span>流程模板<em v-if="templateHint" class="sd-tag" :class="templateHint.ok ? 'ok' : 'warn'">{{ templateHint.text }}</em></span>
            <el-select v-model="form.templateId" size="small" filterable :disabled="!editable" data-testid="source-draft-template" @change="onTemplatePicked">
              <el-option v-for="t in hints?.templates ?? []" :key="t.id" :label="t.name" :value="t.id" />
            </el-select>
          </label>
          <label v-else-if="form.flowMode === 'copy'" class="sd-field">
            <span>参考源</span>
            <!-- 虚拟列表：大网站下源上万（186「贝壳找房」12055 个），el-select 全量渲染 option 要卡十几秒 -->
            <el-select-v2
              v-model="form.templateSourceId"
              :options="siteSourceSelectOptions"
              size="small"
              filterable
              :disabled="!editable"
              data-testid="source-draft-template-source"
              @change="onTemplateSourcePicked"
            />
          </label>
          <div class="sd-field sd-wide">
            <div class="sd-readonly">{{ flowModeText }}</div>
          </div>
        </div>
      </div>

      <div class="sd-sec">
        <div class="sd-sec-t">源清单</div>
        <div class="sd-table-wrap">
          <table class="sd-table">
            <thead>
              <tr>
                <th class="sd-col-idx">序号</th>
                <th>源名称</th>
                <th>URL</th>
                <th class="sd-col-tip">提示</th>
                <th v-if="editable" class="sd-col-op">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in form.sources" :key="i" data-testid="source-draft-row">
                <td class="sd-col-idx">{{ i + 1 }}</td>
                <td><el-input v-model="s.name" size="small" :disabled="!editable" /></td>
                <td><el-input v-model="s.url" size="small" placeholder="选填" :disabled="!editable" /></td>
                <td class="sd-col-tip">
                  <div v-if="!s.url.trim()" class="sd-tip mut">将使用占位 URL，建好后在画布补</div>
                  <div v-if="hints?.duplicates[s.name.trim()]" class="sd-tip warn">已存在同名源（ID {{ hints.duplicates[s.name.trim()] }}），仍可创建</div>
                  <div v-if="s.url.trim() && !hints?.duplicates[s.name.trim()]" class="sd-tip mut">—</div>
                </td>
                <td v-if="editable" class="sd-col-op">
                  <el-button link size="small" type="danger" @click="removeSource(i)">删除</el-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="editable" class="sd-row-actions">
          <el-button link size="small" type="primary" data-testid="source-draft-add" @click="addSource">+ 添加源</el-button>
          <span class="sd-hint">共 {{ form.sources.length }} 个源；采集配置、调度、代理等建好后在画布里配</span>
        </div>
      </div>
    </template>

    <ul v-if="hints?.warnings.length && editable" class="sd-warns">
      <li v-for="w in hints.warnings" :key="w">{{ w }}</li>
    </ul>
    <div v-if="editable && state.error" class="sd-errors" data-testid="source-draft-error">上次确认未建成任何内容：{{ state.error }}</div>
    <ul v-if="editable && touched && errors.length" class="sd-errors" data-testid="source-draft-errors">
      <li v-for="err in errors" :key="err">{{ err }}</li>
    </ul>
    <div v-if="editable && !createEnabled" class="sd-errors" data-testid="source-draft-gate">当前环境未开启新建通道（VITE_SITE_CREATE_TARGET=production），无法新建源</div>

    <ul v-if="state.steps?.length && !editable" class="sd-steps" data-testid="source-draft-steps">
      <li v-for="step in state.steps" :key="step.key" :class="step.status">
        <span class="sd-ic">{{ stepIcon[step.status] }}</span>
        <span>{{ step.label }} <span class="sd-msg">{{ step.detail }}</span></span>
      </li>
    </ul>

    <div v-if="result && result.sources.length" class="sd-result" data-testid="source-draft-result">
      <span v-if="result.siteMode !== 'none'">网站 <b>{{ result.siteName }}</b>（ID {{ result.siteId }}）</span>
      <span v-else>网站 <b>不关联</b></span>
      <span>源 <b>{{ result.sources.map((s) => s.sourceId).join('、') }}</b></span>
      <span v-if="result.flowIds.length">流程 <b>{{ result.flowIds.map((id) => `#${id}`).join('、') }}</b></span>
      <!-- 建好后的主要下一步：做成主色按钮靠右，不和 ID 文字混在一起 -->
      <router-link v-if="canvasLink" :to="canvasLink" class="sd-canvas-btn" data-testid="source-draft-canvas">
        进入画布配置采集
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
        </svg>
      </router-link>
    </div>

    <div v-if="editable" class="sd-actions">
      <el-button size="small" data-testid="source-draft-cancel" @click="emit('cancel')">取消</el-button>
      <el-button
        size="small"
        type="primary"
        :disabled="disabled || resolving || !form || !createEnabled"
        data-testid="source-draft-confirm"
        @click="onConfirm"
      >
        确认创建
      </el-button>
    </div>
    <div v-else-if="state.status === 'creating'" class="sd-actions">
      <el-button size="small" type="primary" loading>创建中</el-button>
    </div>
  </div>
</template>

<style scoped>
.sd-card { margin-top: 10px; border: 1px solid #cbd5e1; border-radius: 10px; background: #f8fafc; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.sd-card.created { border-color: #bbf7d0; background: #f6fef9; }
.sd-card.failed { border-color: #fecaca; }
.sd-card.cancelled { opacity: 0.75; }
.sd-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 13px; color: #334155; flex-wrap: wrap; }
.sd-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
.sd-dot { width: 6px; height: 6px; border-radius: 50%; background: #3b82f6; }
.sd-hint { font-size: 12px; color: #94a3b8; }
.sd-status { font-size: 12px; }
.sd-status.ok { color: #16a34a; }
.sd-status.err { color: #dc2626; }
.sd-status.muted { color: #94a3b8; }
.sd-note { font-size: 12px; background: #fff; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 7px 10px; color: #475569; line-height: 1.6; }
.sd-loading { font-size: 12px; color: #64748b; }
.sd-sec { display: flex; flex-direction: column; gap: 6px; }
.sd-sec-t { font-size: 12px; font-weight: 600; color: #475569; }
.sd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; }
.sd-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #64748b; min-width: 0; }
.sd-wide { grid-column: 1 / -1; }
.sd-readonly { min-height: 24px; line-height: 1.5; padding: 3px 8px; border: 1px solid #e2e8f0; border-radius: 4px; background: #f1f5f9; color: #475569; font-size: 12px; }
.sd-tag { font-style: normal; font-size: 11.5px; border-radius: 4px; padding: 0 6px; margin-left: 6px; }
.sd-tag.ok { background: #ecfdf5; color: #059669; }
.sd-tag.warn { background: #fffbeb; color: #b45309; }
.sd-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
.sd-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sd-table th { background: #f8fafc; color: #475569; font-weight: 600; text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
.sd-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; }
.sd-table tr:last-child td { border-bottom: none; }
.sd-col-idx { width: 36px; color: #94a3b8; }
.sd-col-tip { width: 170px; }
.sd-col-op { width: 52px; }
.sd-tip { font-size: 11.5px; line-height: 1.4; }
.sd-tip.mut { color: #94a3b8; }
.sd-tip.warn { color: #b45309; }
.sd-row-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.sd-warns { margin: 0; padding: 6px 12px 6px 26px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 12px; }
.sd-errors { margin: 0; padding: 8px 12px 8px 26px; border-radius: 6px; background: #fef2f2; color: #b91c1c; font-size: 12px; line-height: 1.6; }
div.sd-errors { padding-left: 12px; }
.sd-steps { list-style: none; margin: 0; padding: 10px 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.sd-steps li { display: flex; gap: 8px; align-items: flex-start; }
.sd-ic { width: 16px; flex-shrink: 0; text-align: center; font-weight: 700; }
.sd-steps .done .sd-ic { color: #16a34a; }
.sd-steps .running .sd-ic { color: #2563eb; }
.sd-steps .failed .sd-ic, .sd-steps .failed .sd-msg { color: #dc2626; }
.sd-steps .skipped { color: #64748b; }
.sd-msg { color: #94a3b8; }
.sd-result { font-size: 12.5px; color: #334155; display: flex; align-items: center; gap: 6px 14px; flex-wrap: wrap; }
.sd-link { color: var(--el-color-primary); text-decoration: none; }
.sd-link:hover { text-decoration: underline; }
.sd-canvas-btn {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 14px; border-radius: 6px;
  background: var(--el-color-primary); color: #fff;
  font-size: 13px; font-weight: 600; text-decoration: none;
  transition: background-color 0.2s ease, box-shadow 0.2s ease;
}
.sd-canvas-btn svg { width: 14px; height: 14px; transition: transform 0.2s ease; }
.sd-canvas-btn:hover { background: var(--el-color-primary-light-3); box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25); }
.sd-canvas-btn:hover svg { transform: translateX(2px); }
.sd-canvas-btn:focus-visible { outline: 2px solid var(--el-color-primary-light-5); outline-offset: 2px; }
.sd-actions { display: flex; justify-content: flex-end; gap: 8px; }
@media (max-width: 720px) {
  .sd-grid { grid-template-columns: 1fr; }
}
</style>
