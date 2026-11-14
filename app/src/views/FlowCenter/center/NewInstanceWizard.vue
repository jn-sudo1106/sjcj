<script setup lang="ts">
// 流程中心「从模板新建实例」四步向导（1109 方案 §5 / §12 C12；交互原型 03/04 节）。
//
// 版式、文案、字段顺序 1:1 对齐 `设计稿/设计方案/1109-流程模板与实例_交互原型_2026-11-09.html`
// 的 `#frame2`（第 3 步 网站与源范围）与 `#frame3`（第 4 步 命名并保存 + 保存结果卡）：
// 左边四步步骤条 + 右边内容区。视觉语言换成项目设计系统：外框用 Element Plus dialog，
// 容器/摘要/结构预览用全局 `rc-*` 设计系统类，交互控件全部用 Element Plus，组件局部样式
// 走本文件 `<style scoped>` 且统一 `niw-` 前缀（不再依赖 flow-center.css 的原型选择器）。
//
// 流程：
//   1 选择模板：模板卡片，结构摘要用 structure.nodes 的 label 链
//   2 查看结构：只读结构预览（节点链 + 分支说明 + 「只读 · 来自模板」）
//   3 网站与源范围：覆盖网站多选 + 源范围四选一 + 默认流程（默认不勾），
//     进入步骤 / 切换范围 / 改网站 / 改默认流程都重新调 previewScope 出计数卡
//   4 命名并保存：实例名称必填，保存调 createInstanceDraft，成功后同一弹窗内切「保存结果卡」
//
// 关键约定：保存只落草稿（实例 + 目标范围意图），不建立任何绑定；「去补齐配置」才是下一步，
// 所以结果卡的主按钮是「去补齐配置」而不是「执行绑定」。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { createInstanceDraft, previewScope } from '@/api/flowCenterCenter'
import type {
  InstanceDraftResult,
  ScopeIntent,
  ScopeMode,
  ScopePreview,
  TemplateMeta,
} from '@/api/types/flowCenterCenter'

const props = defineProps<{ visible: boolean; templates: TemplateMeta[]; presetTemplateId?: string }>()
const emit = defineEmits<{
  close: []
  created: [draft: InstanceDraftResult]
  'go-config': [draft: InstanceDraftResult]
  'bind-failed': [draft: InstanceDraftResult]
}>()

/** 覆盖网站候选。TODO 接 C02 siteCoverage（模板 → 可覆盖网站），后端就绪前先用固定候选。 */
const SITE_CANDIDATES = ['上市公司网站', '深交所网站', '上交所网站']

/** 源范围四选一（互斥），文案与原型 #frame2 逐字一致 */
const SCOPE_MODES: { value: ScopeMode; label: string }[] = [
  { value: 'site-all', label: '该网站全部源' },
  { value: 'unbound', label: '仅未绑定流程的源' },
  { value: 'manual', label: '手选源' },
  { value: 'skip', label: '暂不关联源（稍后在「绑定源」加）' },
]

const MODE_LABEL: Record<ScopeMode, string> = {
  'site-all': '该网站全部源',
  unbound: '仅未绑定流程的源',
  manual: '手选源',
  skip: '暂不关联源',
}

const step = ref(1)
const selectedTemplateId = ref('')
const sites = ref<string[]>([])
const scopeMode = ref<ScopeMode>('site-all')
const setDefault = ref(false)
const name = ref('')
const remark = ref('')
const preview = ref<ScopePreview | null>(null)
const savedPreview = ref<ScopePreview | null>(null)
const optionTotals = ref<{ all?: number; unbound?: number }>({})
const previewLoading = ref(false)
const saving = ref(false)
const result = ref<InstanceDraftResult | null>(null)
/** 预览请求序号：切换范围很快时只认最后一次响应，避免旧响应覆盖新计数 */
let previewSeq = 0

const selectedTemplate = computed(() => props.templates.find((tpl) => tpl.id === selectedTemplateId.value))

const stepItems = computed(() => [
  { no: 1, title: '选择模板', hint: selectedTemplate.value?.name ?? '从模板复制结构' },
  { no: 2, title: '查看结构', hint: '只读预览' },
  {
    no: 3,
    title: '网站与源范围',
    hint: step.value > 3 && preview.value
      ? `${sites.value.join('、')} · ${fmt(preview.value.total)} 个源`
      : '决定这个实例服务谁',
  },
  { no: 4, title: '命名并保存草稿', hint: step.value === 4 ? '只记范围意图，不建绑定' : '不直接生效' },
])

const pageTitle = computed(() => (step.value === 4 ? '命名并保存' : '从模板新建实例'))

/** 只读结构卡的副标题：第 2 步是「只读 · 来自模板」，后续步骤复用同一块结构预览 */
const structurePill = computed(() => (step.value === 2 ? '只读 · 来自模板' : '结构（只读，来自模板）'))

/** 底部左侧的过程提示（沿用原型各步的 wfoot 提示文案） */
const footHint = computed(() => {
  if (result.value) return '点「去补齐配置」进入画布；配置齐全后可回到该实例「确认绑定生效 / 设为默认」。'
  if (step.value === 1) return '模板只固定结构；表 / 参数 / 脚本 / 规则的差异属于实例自己的配置。'
  if (step.value === 2) return '第 2 步只读：结构由模板固定，实例内不可改。'
  if (step.value === 3) return '范围之后还能改：实例行「绑定源」可追加；移除旧流程只能显式「更换关联」。'
  return '保存只落草稿，不建立绑定；配置齐全后才可执行绑定作业并确认生效。'
})

function fmt(value: number | undefined): string {
  return String(value ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '未知错误'
}

/** 当前范围意图（C09 的 ScopeIntent 形状；保存草稿时原样带进 payload） */
function currentScope(): ScopeIntent {
  return {
    sites: [...sites.value],
    mode: scopeMode.value,
    manualSourceIds: [],
    setDefault: setDefault.value,
  }
}

function scopeOf(mode: ScopeMode): ScopeIntent {
  return { ...currentScope(), mode }
}

/** 只认最后一次预览批次（seq）的响应，旧响应不覆盖新计数、也不重复报错 */
async function requestPreview(mode: ScopeMode, seq: number): Promise<ScopePreview | undefined> {
  const tpl = selectedTemplate.value
  if (!tpl) return undefined
  try {
    const data = await previewScope(tpl.id, scopeOf(mode))
    return seq === previewSeq ? data : undefined
  } catch (error) {
    if (seq === previewSeq) ElMessage.error(`范围预览失败：${errorText(error)}`)
    return undefined
  }
}

function applyPreview(data: ScopePreview) {
  preview.value = data
  if (scopeMode.value === 'site-all') optionTotals.value = { ...optionTotals.value, all: data.total }
  if (scopeMode.value === 'unbound') optionTotals.value = { ...optionTotals.value, unbound: data.total }
}

/** 当前范围的计数（切范围 / 改网站 / 改默认流程时刷新） */
async function refreshPreview() {
  const seq = ++previewSeq
  previewLoading.value = true
  try {
    const data = await requestPreview(scopeMode.value, seq)
    if (data) applyPreview(data)
  } finally {
    if (seq === previewSeq) previewLoading.value = false
  }
}

/**
 * 进入第 3 步：一次把「该网站全部源 / 仅未绑定」两个候选的冻结总数取回来，
 * 选项文案里显示（6,564）/（5,988），当前范围的完整计数卡用命中的那次结果。
 */
async function enterStep3() {
  const seq = ++previewSeq
  previewLoading.value = true
  try {
    const [all, unbound] = await Promise.all([requestPreview('site-all', seq), requestPreview('unbound', seq)])
    if (seq !== previewSeq) return
    optionTotals.value = { all: all?.total, unbound: unbound?.total }
    if (scopeMode.value === 'site-all' && all) applyPreview(all)
    else if (scopeMode.value === 'unbound' && unbound) applyPreview(unbound)
    else if (scopeMode.value !== 'site-all' && scopeMode.value !== 'unbound') {
      const current = await requestPreview(scopeMode.value, seq)
      if (current) applyPreview(current)
    }
  } finally {
    if (seq === previewSeq) previewLoading.value = false
  }
}

/** 源范围选项文案：原型带冻结总数「该网站全部源（6,564）」「仅未绑定流程的源（5,988）」 */
function modeLabel(mode: { value: ScopeMode; label: string }): string {
  const total = mode.value === 'site-all' ? optionTotals.value.all : mode.value === 'unbound' ? optionTotals.value.unbound : undefined
  return total === undefined ? mode.label : `${mode.label}（${fmt(total)}）`
}

function chooseTemplate(tpl: TemplateMeta) {
  if (tpl.disabled) {
    ElMessage.warning('该模板已停用，不能用于新建实例')
    return
  }
  selectedTemplateId.value = tpl.id
  if (!sites.value.length) sites.value = [SITE_CANDIDATES[0]!]
  preview.value = null
  optionTotals.value = {}
}

/** 覆盖网站多选（el-checkbox-group 只单向受控，change 里自己落状态，避免一次点击拉两次预览） */
function onSitesChange(value: unknown) {
  sites.value = Array.isArray(value) ? value.map((item) => String(item)) : []
  if (step.value >= 3 && selectedTemplate.value) void enterStep3()
}

function chooseMode(mode: ScopeMode) {
  if (mode === scopeMode.value) return
  scopeMode.value = mode
  preview.value = null
  void refreshPreview()
}

/** 默认流程复选框（默认不勾）：只落状态后刷新「补默认」计数 */
function onDefaultChange(value: unknown) {
  setDefault.value = Boolean(value)
  if (step.value >= 3 && selectedTemplate.value) void refreshPreview()
}

function goStep(target: number) {
  if (target > 1 && !selectedTemplate.value) {
    ElMessage.warning('请先选择模板')
    return
  }
  if (target === 3) {
    step.value = 3
    void enterStep3()
    return
  }
  if (target === 4) {
    if (!sites.value.length) {
      ElMessage.warning('请至少选择一个覆盖网站')
      return
    }
    step.value = 4
    return
  }
  step.value = target
}

/** 空名称拦住，不发请求（必填校验，原型 #frame3 实例名称带 *） */
function validate(): boolean {
  if (!name.value.trim()) {
    ElMessage.warning('请输入实例名称')
    return false
  }
  return true
}

async function saveDraft() {
  const tpl = selectedTemplate.value
  if (!tpl) {
    ElMessage.warning('请先选择模板')
    return
  }
  if (!validate()) return
  saving.value = true
  try {
    const draft = await createInstanceDraft({ name: name.value.trim(), templateId: tpl.id, scope: currentScope() })
    savedPreview.value = preview.value
    result.value = draft
    // 比例：草稿已创建（列表里会出现「待配置 · 不可执行」）；后续配置/绑定的入口由父级接
    emit('created', draft)
  } catch (error) {
    ElMessage.error(`保存草稿失败：${errorText(error)}`)
  } finally {
    saving.value = false
  }
}

function emitClose() {
  emit('close')
}

function emitBindFailed() {
  if (result.value) emit('bind-failed', result.value)
}

function emitGoConfig() {
  if (result.value) emit('go-config', result.value)
}

/** el-dialog 的关闭（右上角 × / Esc）：只认 false，其余状态由 props.visible 驱动 */
function onDialogToggle(value: boolean) {
  if (!value) emitClose()
}

/** 回到初始状态：默认第 1 步；带 presetTemplateId 时直接落到第 2 步（结构已定） */
function resetState() {
  previewSeq += 1
  step.value = 1
  selectedTemplateId.value = ''
  sites.value = []
  scopeMode.value = 'site-all'
  setDefault.value = false
  name.value = ''
  remark.value = ''
  preview.value = null
  savedPreview.value = null
  optionTotals.value = {}
  previewLoading.value = false
  saving.value = false
  result.value = null
  const preset = props.presetTemplateId ? props.templates.find((tpl) => tpl.id === props.presetTemplateId) : undefined
  if (preset && !preset.disabled) {
    selectedTemplateId.value = preset.id
    sites.value = [SITE_CANDIDATES[0]!]
    step.value = 2
  }
}

// visible 打开时初始化；关闭时按契约重置（保留 presetTemplateId 时直接跳第 2 步）
watch(
  () => props.visible,
  () => resetState(),
  { immediate: true },
)
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="pageTitle"
    class="niw-dialog"
    width="680px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    @update:model-value="onDialogToggle"
  >
    <!-- 弹窗内一条轻量工具条：面包屑 + 当前步骤 -->
    <div class="rc-toolbar niw-toolbar">
      <span class="niw-crumb">流程中心 / 从模板新建</span>
      <span class="niw-grow"></span>
      <el-tag size="small" type="info" effect="plain">第 {{ step }} / 4 步</el-tag>
    </div>

    <div class="niw-body">
      <div class="niw-layout">
        <!-- 左：四步步骤条（rc-tree/rc-tree-row 提供列表骨架，.active 为当前步高亮） -->
        <aside class="rc-tree niw-steps">
          <div
            v-for="item in stepItems"
            :key="item.no"
            class="rc-tree-row niw-step"
            :class="{ active: step === item.no, done: step > item.no }"
            data-testid="niw-step"
          >
            <span class="niw-step-no">{{ step > item.no ? '✓' : item.no }}</span>
            <span class="niw-step-tx">{{ item.no }} {{ item.title }}<small>{{ item.hint }}</small></span>
          </div>
        </aside>

        <!-- 右：各步内容 -->
        <div class="niw-main">
          <template v-if="step === 1">
            <h3 class="niw-h3">第 1 步 · 选择模板</h3>
            <p class="niw-sub">从模板复制结构：选中的模板决定第 2 步的只读结构与第 3 步可覆盖的源范围；结构本身不在实例里改。</p>
            <el-alert v-if="!templates.length" class="niw-alert" type="info" :closable="false" show-icon title="暂无可用模板" />
            <div
              v-for="tpl in templates"
              :key="tpl.id"
              class="niw-tpl"
              :class="{ on: tpl.id === selectedTemplateId }"
              data-testid="niw-template"
              :data-template-id="tpl.id"
              @click="chooseTemplate(tpl)"
            >
              <div class="niw-tpl-nm">
                <span class="niw-dot"></span>
                <b>{{ tpl.name }}</b>
                <el-tag v-if="tpl.disabled" size="small" type="info" effect="plain">停用</el-tag>
                <el-tag v-if="tpl.id === selectedTemplateId" size="small" type="primary" effect="light">已选择</el-tag>
              </div>
              <div class="niw-shape">
                <template v-for="(node, index) in tpl.structure.nodes.filter((item) => item.kind !== 'start' && item.kind !== 'end')" :key="node.id">
                  <i v-if="index">›</i>{{ node.label }}
                </template>
              </div>
              <div class="niw-meta">实例 <b>{{ tpl.instanceCount }}</b> · 源 <b>{{ tpl.sourceCount }}</b> · 结构指纹 <b>{{ tpl.structure.fingerprint }}</b></div>
            </div>
          </template>

          <template v-else-if="step === 2">
            <h3 class="niw-h3">第 2 步 · 查看结构</h3>
            <p class="niw-sub">结构预览只读：不暴露别人的表名与凭据；需要改结构请另存为新模板。</p>
          </template>

          <template v-else-if="step === 3">
            <h3 class="niw-h3">第 3 步 · 网站与源范围</h3>
            <p class="niw-sub">
              一套实例配置本来就要服务一批源（186 上 93% 的已绑定源跑在被 51 个以上源共用的流程上）。这里先圈定范围；保存只落<b>草稿</b>：记下实例与目标范围<b>意图</b>，不写任何真实绑定；补齐配置后再执行绑定作业 —— 建实例、配值、绑源不是一件事。
            </p>
          </template>

          <template v-else>
            <h3 class="niw-h3">第 4 步 · 命名并保存</h3>
            <p class="niw-sub">保存只落草稿：记录实例与第 3 步目标范围，<b>不建立绑定</b>；创建、配置、生效是三段状态，未就绪的实例不会成为任何源的执行入口。</p>
          </template>

          <!-- 只读结构（第 2/3/4 步共用；保存结果卡不再重复展示结构） -->
          <div v-if="step >= 2 && !result" class="rc-card niw-struct">
            <div class="rc-card-head">
              <div class="niw-struct-tt">
                <span class="rc-card-title">结构预览</span>
                <span class="rc-card-sub">{{ structurePill }}</span>
              </div>
              <div class="rc-actions">
                <el-tag size="small" type="info" effect="plain">不要在这里改结构</el-tag>
              </div>
            </div>
            <div class="niw-struct-body">
              <div v-if="selectedTemplate" class="niw-chain">
                <template v-for="(node, index) in selectedTemplate.structure.nodes" :key="node.id">
                  <span v-if="index" class="niw-arw">›</span>
                  <span class="niw-node" :class="`is-${node.kind}`"><i></i>{{ node.label }}<small v-if="node.code">{{ node.code }}</small></span>
                </template>
                <span v-for="branch in selectedTemplate.structure.branches" :key="branch" class="niw-branch">分支：{{ branch }}</span>
              </div>
              <p v-else class="niw-hint">请先在第 1 步选择模板</p>
              <p class="niw-hint">节点类型与连接由模板固定；需要改结构请另存为新模板（见 07）。</p>
            </div>
          </div>

          <!-- 第 3 步内容 -->
          <template v-if="step === 3">
            <div class="field niw-field">
              <label class="niw-label">覆盖网站</label>
              <div class="niw-control">
                <el-checkbox-group :model-value="sites" size="small" class="niw-sites" @change="onSitesChange">
                  <el-checkbox v-for="site in SITE_CANDIDATES" :key="site" :value="site" :data-testid="'niw-site'" :data-site="site">
                    {{ site }}
                  </el-checkbox>
                </el-checkbox-group>
                <span class="niw-hint">可多选；实例表「覆盖网站」列看扩散范围</span>
              </div>
            </div>

            <div class="field niw-field">
              <label class="niw-label">源范围</label>
              <div class="niw-control">
                <span class="niw-hint">默认「该网站全部源」；已绑本实例的记为跳过，不重复写</span>
                <el-radio-group :model-value="scopeMode" size="small" class="niw-modes">
                  <el-radio-button
                    v-for="mode in SCOPE_MODES"
                    :key="mode.value"
                    :value="mode.value"
                    :data-testid="'niw-mode'"
                    :data-mode="mode.value"
                    @click="chooseMode(mode.value)"
                  >{{ modeLabel(mode) }}</el-radio-button>
                </el-radio-group>
                <span v-if="scopeMode === 'manual'" class="niw-hint">手选源清单在实例行「绑定源」里逐个挑选；这里只记录范围模式。</span>
              </div>
            </div>

            <div class="field niw-field">
              <label class="niw-label">默认流程</label>
              <div class="niw-control">
                <el-checkbox
                  class="niw-default"
                  :model-value="setDefault"
                  size="small"
                  data-testid="niw-set-default"
                  @change="onDefaultChange"
                ><span class="cb" :class="{ on: setDefault }"></span>设为这些源的默认流程</el-checkbox>
                <span class="niw-hint">
                  默认不勾选：<b>保留已有有效默认</b>；无默认流程的源按下方策略处理（{{ fmt(preview?.defaultFilled) }} 个源将新增默认）
                </span>
              </div>
            </div>

            <div class="rc-mini-card niw-preview" data-testid="niw-preview">
              <span v-if="previewLoading && !preview" class="niw-hint">正在估算范围…</span>
              <span v-else-if="!preview" class="niw-hint">范围计数暂不可用</span>
              <template v-if="preview">
                <span class="rc-status muted">总计 <b>{{ fmt(preview.total) }}</b></span>
                <span class="rc-status run">预计新增 <b>{{ fmt(preview.toAdd) }}</b></span>
                <span class="rc-status muted">预计跳过 <b>{{ fmt(preview.toSkip) }}</b></span>
                <span class="rc-status muted">组内源 <b>{{ fmt(preview.groupSources) }}</b></span>
                <span class="rc-status warn">预计不可操作 <b>{{ fmt(preview.expectedUnavailable) }}</b></span>
                <span class="rc-status muted">预计补默认 <b>{{ fmt(preview.defaultFilled) }}</b><small class="niw-note">不计入合计</small></span>
              </template>
            </div>
            <p class="niw-hint">记录目标范围意图，不建立绑定。</p>

            <el-alert class="niw-alert" type="warning" :closable="false" show-icon>
              <template #title>保存后仍未生效 <small class="niw-alert-sub">补齐配置才能确认绑定</small></template>
              <p>保存只创建实例草稿并记录目标范围（<b>不建立绑定</b>）；<b>输出表、脚本模板、必填参数</b>齐全并通过执行前检查后，才执行绑定作业并把该实例设为源的有效默认流程。草稿实例在列表里显示「待配置 · 不可执行」。</p>
            </el-alert>

            <el-alert class="niw-alert" type="info" :closable="false" show-icon>
              <template #title>保存后会发生什么 <small class="niw-alert-sub">预览只给预计；真实结果看执行回执</small></template>
              <ul class="niw-diff">
                <li class="niw-diff-row"><el-tag size="small" type="success" effect="light">新增</el-tag><span>记录 {{ fmt(preview?.toAdd) }} 个源为目标范围（意图，不是绑定；合计 {{ fmt(preview?.total) }}）</span></li>
                <li class="niw-diff-row"><el-tag size="small" type="info" effect="plain">跳过</el-tag><span>{{ fmt(preview?.toSkip) }} 个（本实例是新建，不可能已有绑定）</span></li>
                <li class="niw-diff-row"><el-tag size="small" type="danger" effect="plain">需单独确认</el-tag><span>{{ fmt(preview?.groupSources) }} 个组内源：流程由源组统一指定，不能单独改</span></li>
                <li class="niw-diff-row"><el-tag size="small" type="warning" effect="plain">失败</el-tag><span>预计不可操作 {{ fmt(preview?.expectedUnavailable) }} 个源（并发快照变化，执行时复核）</span></li>
                <li class="niw-diff-row"><el-tag size="small" type="info" effect="plain">补默认</el-tag><span>{{ fmt(preview?.defaultFilled) }} 个源新增默认（{{ setDefault ? '已勾选' : '未勾选' }}；单独统计，不计入合计）</span></li>
              </ul>
            </el-alert>
          </template>

          <!-- 第 4 步 · 保存结果卡（保存成功后同一弹窗内切换） -->
          <template v-else-if="step === 4 && result">
            <el-alert class="niw-alert" type="success" :closable="false" show-icon data-testid="niw-result">
              <template #title>保存结果 <small class="niw-alert-sub">实例 #{{ result.id }} 已创建 · <b>草稿，未生效</b></small></template>
              <ul class="niw-diff">
                <li class="niw-diff-row"><el-tag size="small" type="success" effect="light">新增</el-tag><span>记录 {{ fmt(savedPreview?.toAdd) }} 个源为目标范围（未建立绑定；合计 {{ fmt(savedPreview?.total ?? result.scopeIntentCount) }}）</span></li>
                <li class="niw-diff-row"><el-tag size="small" type="info" effect="plain">跳过</el-tag><span>{{ fmt(savedPreview?.toSkip) }} 个（新建实例此前没有绑定）</span></li>
                <li class="niw-diff-row"><el-tag size="small" type="warning" effect="plain">失败</el-tag><span>预计不可操作 {{ fmt(savedPreview?.expectedUnavailable) }} 个源（并发快照变化，执行时复核）</span></li>
                <li class="niw-diff-row"><el-tag size="small" type="danger" effect="plain">需单独确认</el-tag><span>{{ fmt(savedPreview?.groupSources) }} 个组内源需在源组里统一调整</span></li>
                <li class="niw-diff-row"><el-tag size="small" type="info" effect="plain">补默认</el-tag><span>{{ fmt(savedPreview?.defaultFilled) }} 个源新增默认（{{ setDefault ? '已勾选' : '未勾选' }}；单独统计，不计入合计）</span></li>
              </ul>
            </el-alert>

            <el-alert class="niw-alert" type="warning" :closable="false" show-icon>
              <template #title>配置就绪检查 <small class="niw-alert-sub">2 项缺失 · 暂不可设为默认</small></template>
              <p>缺失：输出表未选、脚本模板未指定。<br><b>“绑定成功”不等于“能跑”</b>：草稿只建立关联，源的有效执行入口不变。</p>
            </el-alert>
          </template>

          <!-- 第 4 步 · 命名表单 -->
          <template v-else-if="step === 4">
            <div class="rc-mini-card niw-summary" data-testid="niw-scope-summary">
              <dl class="rc-kv">
                <dt>覆盖网站</dt>
                <dd>{{ sites.join('、') || '未选' }}</dd>
                <dt>源范围</dt>
                <dd>{{ MODE_LABEL[scopeMode] }}</dd>
                <dt>合计</dt>
                <dd>{{ fmt(preview?.total) }} 个源</dd>
                <dt>补默认</dt>
                <dd>{{ fmt(preview?.defaultFilled) }} 个源（不计入合计）</dd>
              </dl>
            </div>

            <div class="field niw-field">
              <label class="niw-label">实例名称 <span class="niw-req">*</span></label>
              <div class="niw-control">
                <el-input v-model="name" size="small" data-testid="niw-name" placeholder="请输入实例名称" />
                <span class="niw-hint">同名不拦截，但会提示已存在</span>
              </div>
            </div>
            <div class="field niw-field">
              <label class="niw-label">用途备注</label>
              <div class="niw-control">
                <el-input v-model="remark" size="small" placeholder="选填：谁在用、覆盖哪些栏目" />
              </div>
            </div>
            <div class="field niw-field">
              <label class="niw-label">输出表</label>
              <div class="niw-control">
                <el-input size="small" disabled placeholder="未选择" />
                <span class="niw-hint">选填 · 可留空</span>
              </div>
            </div>
            <div class="field niw-field">
              <label class="niw-label">脚本模板</label>
              <div class="niw-control">
                <el-select size="small" disabled placeholder="未指定">
                  <el-option label="未指定" value="" />
                </el-select>
                <span class="niw-hint">选填</span>
              </div>
            </div>
            <p class="niw-hint">草稿只保存实例与目标范围意图，激活时才写绑定。</p>
          </template>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="niw-foot">
        <span class="niw-foot-hint">{{ footHint }}</span>
        <div class="niw-foot-acts">
          <template v-if="result">
            <el-button size="small" data-testid="niw-later" @click="emitClose">稍后处理</el-button>
            <el-button size="small" data-testid="niw-bind-failed" @click="emitBindFailed">继续绑定失败项</el-button>
            <el-button size="small" type="primary" data-testid="niw-go-config" @click="emitGoConfig">去补齐配置</el-button>
          </template>
          <template v-else-if="step === 1">
            <el-button size="small" @click="emitClose">取消</el-button>
            <el-button size="small" type="primary" data-testid="niw-next" @click="goStep(2)">下一步：查看结构</el-button>
          </template>
          <template v-else-if="step === 2">
            <el-button size="small" data-testid="niw-back" @click="goStep(1)">上一步</el-button>
            <el-button size="small" @click="emitClose">取消</el-button>
            <el-button size="small" type="primary" data-testid="niw-next" @click="goStep(3)">下一步：网站与源范围</el-button>
          </template>
          <template v-else-if="step === 3">
            <el-button size="small" data-testid="niw-back" @click="goStep(2)">上一步</el-button>
            <el-button size="small" @click="emitClose">取消</el-button>
            <el-button size="small" type="primary" data-testid="niw-next" @click="goStep(4)">下一步：命名并保存草稿</el-button>
          </template>
          <template v-else>
            <el-button size="small" data-testid="niw-back" @click="goStep(3)">上一步</el-button>
            <el-button size="small" @click="emitClose">取消</el-button>
            <el-button size="small" type="primary" data-testid="niw-save" :disabled="saving" @click="saveDraft">
              {{ saving ? '保存中…' : '保存草稿' }}
            </el-button>
          </template>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 弹窗壳（Element dialog 是 teleport 到 body 的，拿不到 scoped id，这里用唯一类名做局部全局覆盖）：
   白底 + 8px 圆角 + 14px 加粗标题栏 + 底部分隔线，和项目其他弹窗一致 */
:global(.niw-dialog) {
  border-radius: var(--rc-radius);
  background: var(--rc-surface);
}
:global(.niw-dialog .el-dialog__header) {
  margin: 0;
  padding: 11px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
}
:global(.niw-dialog .el-dialog__title) {
  color: var(--rc-text);
  font-size: 14px;
  font-weight: 700;
}
:global(.niw-dialog .el-dialog__headerbtn) {
  top: 8px;
  right: 8px;
}
:global(.niw-dialog .el-dialog__body) {
  max-height: 68vh;
  padding: 0;
  overflow: auto;
  color: var(--rc-text);
}
:global(.niw-dialog .el-dialog__footer) {
  padding: 9px 16px;
  border-top: 1px solid var(--rc-border-soft);
  background: var(--rc-surface);
}

/* ---------- 工具条 / 容器 ---------- */
.niw-toolbar {
  min-height: 38px;
  padding: 6px 16px;
}
.niw-crumb {
  font-size: 12px;
  color: var(--rc-muted);
}
.niw-grow {
  flex: 1;
  min-width: 0;
}
.niw-body {
  padding: 12px 16px 16px;
}
.niw-layout {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

/* ---------- 左侧步骤条（rc-tree-row 提供行骨架，这里只做紧凑化与序号样式） ---------- */
.niw-steps {
  flex: none;
  width: 154px;
  padding: 0;
  border-right: 1px solid var(--rc-border-soft);
}
.niw-step {
  justify-content: flex-start;
  gap: 8px;
  padding: 0 8px;
}
.niw-step-no {
  flex: none;
  width: 17px;
  height: 17px;
  border: 1px solid var(--rc-border);
  border-radius: 50%;
  background: var(--rc-surface);
  color: var(--rc-muted);
  font-size: 11px;
  line-height: 15px;
  text-align: center;
}
.niw-step.done .niw-step-no {
  border-color: var(--rc-primary);
  color: var(--rc-primary);
}
.niw-step.active .niw-step-no {
  border-color: var(--rc-primary);
  background: var(--rc-primary);
  color: var(--rc-surface);
  font-weight: 700;
}
.niw-step-tx {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: 12px;
  line-height: 1.35;
}
/* 提示不截断：窄列里让它换行，避免「决定这个实例服...」这种被吃掉的字 */
.niw-step-tx small {
  color: var(--rc-faint);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

/* ---------- 右侧内容 ---------- */
.niw-main {
  flex: 1;
  min-width: 0;
}
.niw-h3 {
  margin: 0 0 3px;
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
.niw-sub {
  margin: 0 0 10px;
  color: var(--rc-text-2);
  font-size: 12px;
  line-height: 1.6;
}
.niw-sub b {
  color: var(--rc-text);
}
.niw-hint {
  margin: 0;
  color: var(--rc-faint);
  font-size: 11px;
  line-height: 1.5;
}
.niw-note {
  margin-left: 3px;
  color: var(--rc-faint);
  font-size: 11px;
  font-weight: 400;
}

/* ---------- 第 1 步：模板卡片 ---------- */
.niw-tpl {
  margin-bottom: 8px;
  padding: 9px 11px;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius-sm);
  background: var(--rc-surface);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.niw-tpl:hover {
  border-color: var(--rc-primary);
}
.niw-tpl.on {
  border-color: var(--rc-primary);
  background: var(--rc-primary-bg);
}
.niw-tpl-nm {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--rc-text);
  font-size: 13px;
}
.niw-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--rc-primary);
}
.niw-shape {
  margin-top: 4px;
  color: var(--rc-muted);
  font-size: 11px;
}
.niw-shape i {
  margin: 0 5px;
  color: var(--rc-faint);
  font-style: normal;
}
.niw-meta {
  margin-top: 3px;
  color: var(--rc-faint);
  font-size: 11px;
}
.niw-meta b {
  color: var(--rc-text-2);
  font-weight: 700;
}

/* ---------- 只读结构卡 ---------- */
.niw-struct {
  margin-bottom: 10px;
}
.niw-struct .rc-card-head {
  min-height: 40px;
  padding: 7px 12px;
}
.niw-struct-tt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.niw-struct-body {
  padding: 9px 12px 10px;
}
.niw-struct-body > .niw-hint {
  margin-top: 6px;
}
.niw-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 6px;
  margin-bottom: 6px;
}
.niw-arw {
  color: var(--rc-faint);
  font-size: 11px;
}
.niw-node {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 7px;
  border: 1px solid var(--rc-border);
  border-radius: 999px;
  background: var(--rc-surface);
  color: var(--rc-text-2);
  font-size: 11px;
}
.niw-node i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--rc-faint);
}
.niw-node small {
  color: var(--rc-faint);
  font-size: 11px;
}
.niw-node.is-rule {
  background: var(--rc-primary-bg);
  color: var(--rc-primary-ink);
}
.niw-node.is-rule i {
  background: var(--rc-primary);
}
.niw-node.is-out {
  background: var(--rc-cyan-bg);
}
.niw-node.is-out i {
  background: var(--rc-cyan);
}
.niw-branch {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--rc-warn-bg);
  color: var(--rc-warn);
  font-size: 11px;
}

/* ---------- 表单行（.field 是测试钩子，视觉全在本文件的 niw-* 里） ---------- */
.niw-field {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
}
.niw-label {
  flex: none;
  width: 66px;
  padding-top: 5px;
  color: var(--rc-text-2);
  font-size: 12px;
  text-align: right;
}
.niw-req {
  color: var(--rc-error);
}
.niw-control {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.niw-sites {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 14px;
}
/* 源范围四选一：el-radio-button 默认是「贴边分段」，选项文案长会换行，
   这里改成互相独立的圆角胶囊，换行后每颗仍然完整（不影响取值/点击语义） */
.niw-modes {
  display: flex;
  flex-wrap: wrap;
  align-self: flex-start;
  gap: 6px;
}
.niw-modes :deep(.el-radio-button) {
  margin-left: 0 !important;
}
.niw-modes :deep(.el-radio-button__inner) {
  padding: 5px 10px !important;
  border: 1px solid var(--rc-border) !important;
  border-radius: var(--rc-radius-sm) !important;
  box-shadow: none !important;
  color: var(--rc-text-2);
  font-size: 11px;
  font-weight: 400;
}
.niw-modes :deep(.el-radio-button__inner:hover) {
  border-color: var(--rc-primary) !important;
  color: var(--rc-primary-ink);
}
.niw-modes :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  border-color: var(--rc-primary) !important;
  background: var(--rc-primary-bg) !important;
  color: var(--rc-primary-ink);
  font-weight: 700;
}
/* .cb / .on 是测试钩子（勾选态断言），视觉交给 el-checkbox 自身，这里只做无障碍隐藏 */
.niw-default .cb {
  display: none;
}

/* ---------- 第 3 步：范围计数卡 ---------- */
.niw-preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  padding: 10px 12px;
}
.niw-preview .rc-status {
  font-weight: 400;
}
.niw-preview .rc-status b {
  font-weight: 700;
}

/* ---------- 说明 / 就绪提示 ---------- */
.niw-alert {
  margin-top: 8px;
}
.niw-alert :deep(.el-alert__title) {
  color: var(--rc-text);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}
.niw-alert :deep(.el-alert__description) {
  margin: 5px 0 0;
  color: var(--rc-text-2);
  font-size: 11px;
  line-height: 1.65;
}
.niw-alert :deep(.el-alert__description) p {
  margin: 0;
}
.niw-alert-sub {
  color: var(--rc-muted);
  font-size: 11px;
  font-weight: 400;
}
.niw-diff {
  margin: 0;
  padding: 0;
  list-style: none;
}
.niw-diff-row {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 4px;
}
.niw-diff-row:first-child {
  margin-top: 0;
}

/* ---------- 第 4 步：范围摘要 ---------- */
.niw-summary {
  margin: 0 0 10px;
  padding: 11px 12px;
}

/* ---------- 底部操作区（按钮右对齐） ---------- */
.niw-foot {
  display: flex;
  align-items: center;
  gap: 12px;
}
.niw-foot-hint {
  flex: 1;
  min-width: 0;
  color: var(--rc-faint);
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
}
.niw-foot-acts {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
}
</style>