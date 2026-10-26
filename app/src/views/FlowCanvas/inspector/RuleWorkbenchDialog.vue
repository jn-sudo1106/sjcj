<script setup lang="ts">
// 编排工作区（L3 全屏弹层，S6-1，方案 §4.1）：合并原来各自独立的 RuleScriptDialog（脚本查看，只读）+
// RuleSystemPromptDialog（编辑系统提示词）——会议原话"是不是把它放到一个界面里面去，就是你脚本和那个
// 东西，它能对应上""要两边能看到，不然的话这个东西一直卡在里面，啥也看不到"。
// 左栏系统提示词 / 右栏脚本（或抓取配置 XML），中间可拖拽分隔；面板内直接放生成/保存，
// 避免"看着提示词，要退出去才能生成"（方案 §4.1 改法 3）。
//
// 保存语义刻意保留两种不同颗粒度，跟合并前一致，没有为了"统一"而改变行为：
//   - 系统提示词：本地草稿 + 显式「保存」——沿用原 RuleSystemPromptDialog 的"取消不污染已保存值"设计
//     （只在本组件内部提交草稿，emit update:systemPrompt，不打后端；打开时从 props.systemPrompt 重置草稿）。
//   - 脚本/配置：直接双向绑定（每次输入都 emit update:script），没有草稿概念——原来这块是只读的，
//     S6-1 才第一次开放编辑，没有"取消"包袱要延续，直接绑定跟本应用其余文本框风格一致，更简单。
//     真正落盘由外部「保存脚本/配置」按钮触发（走 fileUploadScript 接口 + 二次确认，逻辑留在父组件不重复）。
import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { fetchDefaultModels, fetchModelProviders, type ModelOption, type ModelProviderOption, type PromptCategory, type RuleFieldOption, type RuleOrchestration } from '@/api'
import type { PromptCategoryGroup } from './promptCategory'
import { renderPromptTemplateForNode } from './promptTemplateLoader'
import { fetchPromptList, type PromptTemplateItem } from '@/api/prompt'
import PromptTemplatePicker from './PromptTemplatePicker.vue'
import { nodePromptApi } from '@/api/nodePrompts'
import { nodePromptsAvailable } from '@/constants/deployGates'

const props = defineProps<{
  open: boolean
  title: string
  scriptLabel: string
  systemPrompt: string
  promptCategory: PromptCategory
  promptListCategory: string
  promptCategoryGroups: PromptCategoryGroup[]
  modelProviderCode?: string
  modelCode?: string
  inputTableName?: string
  outputTableName?: string
  sourceId?: string
  sourceCron?: string
  inputFields: string[]
  outputFields: string[]
  inputFieldOptions: RuleFieldOption[]
  outputFieldOptions: RuleFieldOption[]
  script: string
  scriptPath?: string
  thinking?: string
  generationState?: 'idle' | 'thinking' | 'content' | 'done' | 'error'
  generationMessage?: string
  generateLabel: string
  saveLabel: string
  generating: boolean
  saving: boolean
  // 是否为规则处理节点（控制是否展示「测试脚本」按钮）
  isRule: boolean
  // 文章摘要/打标签节点查看并编辑系统提示词时，复用工作台弹窗外壳但隐藏脚本编辑能力。
  promptPreviewOnly?: boolean
  promptPreviewSaving?: boolean
  /** Saved/manual node prompts stay independent when reopening the work area. */
  preservePrompt?: boolean
  promptTemplateId?: number
  configId?: string
  // 测试脚本是否可点（脚本非空且已绑输入表）
  canTest: boolean
  // 预览表第一行数据，作为脚本测试入参（key=字段名，value=值）
  firstRowParams?: Record<string, unknown>
  // 规则处理/数据监控节点：打开工作区时左栏默认展示描述（只读），系统提示词需点按钮展开
  describe: string
  describeLabel: string
  hidePromptByDefault: boolean
}>()
const emit = defineEmits<{
  'update:open': [boolean]
  'update:systemPrompt': [string]
  'update:promptCategory': [PromptCategory]
  'update:promptTemplateId': [number | undefined]
  'update:modelProviderCode': [string]
  'update:modelCode': [string]
  'update:script': [string]
  'save-prompt-preview': [string]
  /** 用户点了左栏「保存」（区别于 loadPromptTemplate 自动回写：那条不算用户编辑） */
  'prompt-saved': []
  generate: [Partial<Pick<RuleOrchestration, 'systemPrompt' | 'promptCategory' | 'promptTemplateId' | 'modelProviderCode' | 'modelCode'>>]
  'cancel-generate': []
  save: []
  test: []
}>()

function close() {
  emit('update:open', false)
}

// 系统提示词草稿：只在打开时从 props 重置，取消/关闭不回写
const promptDraft = ref(props.systemPrompt)
const promptChoices = ref<PromptTemplateItem[]>([]), selectedPromptId = ref(props.promptTemplateId ?? 0)
const promptSnapshot = ref(props.systemPrompt)
const bindingSaving = ref(false)
// 没有节点提示词接口的环境（业务后端）不读写选择，否则保存 / 生成会被接口失败拦住（2026-10-26）。
const persistedConfigId = computed(() => nodePromptsAvailable() && /^\d{1,18}$/.test(props.configId || '') ? props.configId! : '')
const promptCategoryDraft = ref<PromptCategory>(props.promptCategory)
const modelProviderDraft = ref(props.modelProviderCode || '')
const modelDraft = ref(props.modelCode || '')
const providerOptions = ref<ModelProviderOption[]>([])
const modelOptions = ref<ModelOption[]>([])
const providerLoading = ref(false)
const modelLoading = ref(false)
const providerError = ref('')
const modelError = ref('')
const promptLoading = ref(false)
const promptError = ref('')
let promptRequestSeq = 0
const firstPromptCategory = computed(() => props.promptCategoryGroups[0]?.options[0]?.value ?? '自定义节点')
function firstProviderCode() {
  return providerOptions.value[0]?.providerCode || ''
}
function firstModelCode() {
  return modelOptions.value[0]?.modelCode || ''
}
async function loadModels(providerCode: string, preferredModelCode?: string) {
  modelLoading.value = true
  modelError.value = ''
  try {
    modelOptions.value = await fetchDefaultModels(providerCode)
    modelDraft.value = modelOptions.value.find((item) => item.modelCode === preferredModelCode)?.modelCode || firstModelCode()
  } catch (e) {
    modelOptions.value = []
    modelDraft.value = ''
    modelError.value = `模型加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    modelLoading.value = false
  }
}
async function loadProviderModelOptions() {
  providerLoading.value = true
  providerError.value = ''
  try {
    providerOptions.value = await fetchModelProviders()
    modelProviderDraft.value = providerOptions.value.find((item) => item.providerCode === modelProviderDraft.value)?.providerCode || firstProviderCode()
    if (!modelProviderDraft.value) {
      modelOptions.value = []
      modelDraft.value = ''
      return
    }
    await loadModels(modelProviderDraft.value, modelDraft.value)
  } catch (e) {
    providerOptions.value = []
    modelOptions.value = []
    modelProviderDraft.value = ''
    modelDraft.value = ''
    providerError.value = `模型供应商加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    providerLoading.value = false
  }
}
async function loadPromptTemplate(apply = true, restoreSelection = false) {
  const seq = ++promptRequestSeq
  promptLoading.value = true
  promptError.value = ''
  try {
    const [choices, selection] = await Promise.all([
      fetchPromptList(props.promptListCategory, promptCategoryDraft.value),
      restoreSelection && persistedConfigId.value && !props.promptTemplateId ? nodePromptApi.selection(persistedConfigId.value).catch(() => null) : Promise.resolve(null),
    ])
    if (seq !== promptRequestSeq) return
    promptChoices.value = choices.filter(item => item.isActive !== 0)
    if (selection?.promptTemplateId || selection?.hasSelection) {
      selectedPromptId.value = selection.promptTemplateId
      emit('update:promptTemplateId', selection.promptTemplateId || undefined)
      if (!selection.promptTemplateId) return
    }
    if (!apply) return
    const chosen = selectedPromptId.value ? promptChoices.value.find(item => item.promptId === selectedPromptId.value) : promptChoices.value[0]
    if (!chosen) { promptError.value = selectedPromptId.value ? '所选提示词已停用或不可用，保留当前内容，请重新选择' : '当前类型未配置启用的提示词'; return }
    const applied = renderPromptTemplateForNode(chosen, {
      promptListCategory: props.promptListCategory,
      promptCategory: promptCategoryDraft.value,
      inputTableName: props.inputTableName?.trim() || '',
      outputTableName: props.outputTableName?.trim() || props.inputTableName?.trim() || '',
      sourceId: props.sourceId?.trim() || '',
      sourceCron: props.sourceCron?.trim() || '',
      inputFields: props.inputFields,
      outputFields: props.outputFields,
      inputFieldOptions: props.inputFieldOptions,
      outputFieldOptions: props.outputFieldOptions.length ? props.outputFieldOptions : props.inputFieldOptions,
      providerCode: modelProviderDraft.value,
      model: modelDraft.value,
      describe: props.describe,
    })
    if (seq !== promptRequestSeq) return
    if (!applied) {
      promptError.value = '提示词模板为空'
      return
    }
    // 拼接后的完整提示词（角色定义+源表/入参+目标表/出参+核心逻辑+输出要求，占位符已替换为当前表/字段）。
    // 同步写回父组件 orchCfg.systemPrompt：生成脚本（data-process）入参 systemPrompt 取的就是这个完整值，
    // 确保即使用户没在工作台点「保存」，生成脚本时也能拿到拼接后的完整提示词而非种子默认值或未替换占位符的模板。
    // 手动编辑的「取消不污染」仍由 savePrompt 显式 emit 保障——此处自动回写不算用户编辑。
    promptDraft.value = applied
    promptSnapshot.value = applied
    selectedPromptId.value = chosen.promptId
    emit('update:promptTemplateId', chosen.promptId)
    emit('update:systemPrompt', applied)
  } catch (e) {
    if (seq !== promptRequestSeq) return
    promptError.value = `提示词模板加载失败：${(e as Error)?.message ?? String(e)}`
  } finally {
    if (seq === promptRequestSeq) promptLoading.value = false
  }
}
function syncLocalDrafts() {
  promptDraft.value = props.systemPrompt
  promptSnapshot.value = props.systemPrompt
  selectedPromptId.value = props.promptTemplateId ?? 0
  promptCategoryDraft.value = props.promptCategory || firstPromptCategory.value
  modelProviderDraft.value = props.modelProviderCode || ''
  modelDraft.value = props.modelCode || ''
}
watch(() => props.open, (v) => {
  if (v) {
    syncLocalDrafts()
    promptVisible.value = !props.hidePromptByDefault
    if (!props.promptPreviewOnly) {
      // 先解析供应商/模型（props 没带模型时 loadModels 会自动落到第一个），再拼模板：
      // 并行的话 `{{model}}` 会按空值替换一次，展示/保存的提示词就少一个模型名。
      void loadProviderModelOptions().then(() => loadPromptTemplate(!props.preservePrompt, true))
    } else void loadPromptTemplate(false, true)
  }
})
watch(() => props.promptCategory, (v) => {
  if (props.open) promptCategoryDraft.value = v || firstPromptCategory.value
})
watch(() => props.modelProviderCode, (v) => {
  if (props.open) modelProviderDraft.value = v || firstProviderCode()
})
watch(() => props.modelCode, (v) => {
  if (props.open) modelDraft.value = v || firstModelCode()
})
async function persistPromptChoice(id = selectedPromptId.value) {
  if (!persistedConfigId.value) return true
  if (bindingSaving.value) return false
  bindingSaving.value = true
  try { await nodePromptApi.select(persistedConfigId.value, id); promptError.value = ''; return true }
  catch (error) { promptError.value = `保存提示词选择失败：${error instanceof Error ? error.message : String(error)}`; return false }
  finally { bindingSaving.value = false }
}
watch(persistedConfigId, (id, previous) => { if (id && !previous && selectedPromptId.value) void persistPromptChoice() })
async function savePrompt() {
  if (!await persistPromptChoice()) return
  // 先置位「用户手改」再回写：编排配置的自动拼接 watcher 据此不再把手改值覆盖回模板
  // （loadPromptTemplate 的自动 emit 不走这里，所以自动回写不算用户编辑）
  emit('prompt-saved')
  emit('update:systemPrompt', promptDraft.value)
  emit('update:promptCategory', promptCategoryDraft.value)
  emit('update:promptTemplateId', selectedPromptId.value || undefined)
  emit('update:modelProviderCode', modelProviderDraft.value)
  emit('update:modelCode', modelDraft.value)
  ElMessage.success('系统提示词已保存')
}
async function savePromptPreview() { if (await persistPromptChoice()) emit('save-prompt-preview', promptDraft.value) }

async function onPromptCategoryChange(value: PromptCategory) {
  promptCategoryDraft.value = value
  selectedPromptId.value = 0
  emit('update:promptTemplateId', undefined)
  await loadPromptTemplate()
}
async function onPromptChoice(value: unknown) {
  if (typeof value !== 'number' || value === selectedPromptId.value) return
  if (value && promptDraft.value !== promptSnapshot.value) {
    try { await ElMessageBox.confirm('切换提示词将替换当前编辑内容，是否继续？', '切换提示词', { confirmButtonText: '切换', cancelButtonText: '保留当前内容', type: 'warning' }) } catch { return }
  }
  if (!await persistPromptChoice(value)) return
  selectedPromptId.value = value
  emit('prompt-saved')
  emit('update:promptTemplateId', value || undefined)
  if (value) await loadPromptTemplate()
}

async function onProviderChange(value: string) {
  modelProviderDraft.value = value
  await loadModels(value, modelDraft.value)
  if (!modelDraft.value) modelDraft.value = firstModelCode()
  // 供应商/模型换档后 `{{provider_code}}`、`{{model}}` 要立刻跟着重拼（用户 2026-10-09 要求）
  await loadPromptTemplate()
}

async function onModelChange() {
  await loadPromptTemplate()
}

function onScriptInput(e: Event) {
  emit('update:script', (e.target as HTMLTextAreaElement).value)
}
async function onGenerate() {
  if (!await persistPromptChoice()) return
  emit('generate', {
    systemPrompt: promptDraft.value,
    promptCategory: promptCategoryDraft.value,
    promptTemplateId: selectedPromptId.value || undefined,
    modelProviderCode: modelProviderDraft.value,
    modelCode: modelDraft.value,
  })
}
function onGenerateClick() {
  if (props.generating) {
    emit('cancel-generate')
    return
  }
  onGenerate()
}

// 中间拖拽分隔（左栏宽度百分比，25%~75% 夹住，跟 FlowCanvas/index.vue 的检查区分隔条同款交互）
const leftPct = ref(42)
// 左栏视图切换：规则处理/数据监控节点默认展示描述（只读），点「系统提示词」按钮切换到提示词编辑区
const promptVisible = ref(!props.hidePromptByDefault)
const showDescribeInLeft = computed(() => props.hidePromptByDefault && !promptVisible.value)
const bodyEl = ref<HTMLElement>()
const thinkingCollapsed = ref(false)
let splitStartX = 0
let splitStartPct = 0
function onSplitMove(e: MouseEvent) {
  const w = bodyEl.value?.clientWidth || 1
  const deltaPct = ((e.clientX - splitStartX) / w) * 100
  leftPct.value = Math.min(75, Math.max(25, splitStartPct + deltaPct))
}
function onSplitEnd() {
  window.removeEventListener('mousemove', onSplitMove)
  window.removeEventListener('mouseup', onSplitEnd)
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}
function onSplitStart(e: MouseEvent) {
  e.preventDefault()
  splitStartX = e.clientX
  splitStartPct = leftPct.value
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onSplitMove)
  window.addEventListener('mouseup', onSplitEnd)
}

const leftStyle = computed(() => ({ flex: `0 0 ${leftPct.value}%` }))
const streamStateLabel = computed(() => {
  switch (props.generationState) {
    case 'thinking': return '思考中'
    case 'content': return '输出中'
    case 'done': return '已完成'
    case 'error': return '出错'
    default: return props.generating ? '生成中' : props.script.trim() ? '已生成' : '待生成'
  }
})
const thinkingBodyRef = ref<HTMLElement | null>(null)
async function scrollThinkingToBottom() {
  await nextTick()
  const el = thinkingBodyRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}
watch(
  () => [props.open, props.generating, props.thinking, props.generationState] as const,
  () => {
    if (!props.open) return
    if (props.generating || (props.thinking?.trim()) || props.generationState === 'done') thinkingCollapsed.value = false
  },
  { immediate: true },
)
watch(
  () => [props.open, props.generating, props.thinking, props.generationState, thinkingCollapsed.value] as const,
  () => {
    if (!props.open || thinkingCollapsed.value) return
    if (props.generating || props.thinking?.trim() || props.generationState === 'done' || props.generationState === 'error') {
      void scrollThinkingToBottom()
    }
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="94vw"
    top="4vh"
    :close-on-click-modal="false"
    :data-testid="promptPreviewOnly ? 'prompt-preview-dialog' : undefined"
    @update:model-value="close"
  >
    <div v-if="promptPreviewOnly" class="wb-preview">
      <PromptTemplatePicker :items="promptChoices" :model-value="selectedPromptId" :loading="promptLoading" :disabled="promptPreviewSaving || bindingSaving" test-id="config-prompt-template" @select="onPromptChoice" />
      <div class="wb-preview-head">
        <b>系统提示词</b>
        <div class="wb-preview-actions">
          <span>可编辑</span>
          <button
            class="rc-btn primary"
            type="button"
            data-testid="prompt-preview-save"
            :disabled="promptPreviewSaving"
            @click="savePromptPreview"
          >
            {{ promptPreviewSaving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
      <textarea
        v-model="promptDraft"
        class="wb-preview-textarea"
        data-testid="prompt-preview-textarea"
        placeholder="请输入系统提示词"
      />
    </div>
    <div v-else ref="bodyEl" class="wb-body">
      <div class="wb-pane" :style="leftStyle">
        <div class="wb-pane-head">
          <b>{{ showDescribeInLeft ? describeLabel : '系统提示词' }}</b>
          <button v-if="hidePromptByDefault" class="rc-btn" type="button" @click="promptVisible = !promptVisible">
            {{ showDescribeInLeft ? '系统提示词' : describeLabel }}
          </button>
          <el-select
            v-if="!showDescribeInLeft"
            v-model="promptCategoryDraft"
            class="wb-category"
            size="small"
            :teleported="false"
            popper-class="wb-popper"
            @change="onPromptCategoryChange"
          >
            <el-option-group v-for="group in promptCategoryGroups" :key="group.label" :label="group.label">
              <el-option v-for="item in group.options" :key="item.value" :label="item.label" :value="item.value" />
            </el-option-group>
          </el-select>
          <span>模型供应商</span>
          <el-select
            v-model="modelProviderDraft"
            class="wb-category wb-provider"
            size="small"
            :loading="providerLoading"
            :teleported="false"
            placeholder="模型供应商"
            @change="onProviderChange"
          >
            <el-option v-for="item in providerOptions" :key="item.providerCode" :label="item.providerName" :value="item.providerCode" />
          </el-select>
          <span>模型</span>
          <el-select
            v-model="modelDraft"
            class="wb-category wb-model"
            size="small"
            :loading="modelLoading"
            :disabled="!modelProviderDraft || !providerOptions.length"
            :teleported="false"
            placeholder="模型"
            @change="onModelChange"
          >
            <el-option v-for="item in modelOptions" :key="item.modelCode" :label="item.modelName" :value="item.modelCode" />
          </el-select>
          <button class="rc-btn primary" type="button" :disabled="promptLoading || providerLoading || modelLoading" @click="savePrompt">保存</button>
        </div>
        <PromptTemplatePicker :items="promptChoices" :model-value="selectedPromptId" :loading="promptLoading" :disabled="generating || saving || bindingSaving" test-id="config-prompt-template" @select="onPromptChoice" />
        <div v-if="providerError || modelError || promptError || (!showDescribeInLeft && promptLoading)" class="wb-help">
          {{ !showDescribeInLeft && promptLoading ? '提示词模板加载中…' : (promptError || providerError || modelError) }}
        </div>
        <textarea
          v-if="showDescribeInLeft"
          class="wb-textarea wb-describe"
          :value="describe"
          readonly
          placeholder="暂无描述"
        />
        <textarea
          v-else
          v-model="promptDraft"
          class="wb-textarea"
          placeholder="描述生成脚本时应遵循的约束，如入口函数签名、禁止访问外部网络等"
        />
      </div>

      <div class="wb-splitter" @mousedown="onSplitStart" />

      <div class="wb-pane wb-pane-right">
        <div class="wb-pane-head">
          <b>{{ scriptLabel }}</b>
          <span class="wb-state">{{ streamStateLabel }}</span>
          <span class="wb-path">{{ scriptPath || '未生成' }}</span>
          <div class="wb-pane-actions">
            <button
              class="rc-btn"
              :class="{ 'is-generating': generating }"
              type="button"
              :aria-label="generating ? '取消生成脚本' : generateLabel"
              :title="generating ? '取消生成脚本' : generateLabel"
              @click="onGenerateClick"
            >
              <span v-if="generating" class="rc-stop-icon" data-testid="stop-generation-icon" aria-hidden="true" />
              <template v-else>{{ generateLabel }}</template>
            </button>
            <button class="rc-btn primary" type="button" :disabled="saving || !script.trim()" @click="emit('save')">
              {{ saving ? '保存中...' : saveLabel }}
            </button>
            <button v-if="isRule" class="rc-btn" type="button" :disabled="!canTest" @click="emit('test')">测试脚本</button>
          </div>
        </div>
        <div v-if="thinking?.trim() || generating || generationState === 'done' || generationState === 'error'" class="wb-stream">
          <button type="button" class="wb-stream-head" @click="thinkingCollapsed = !thinkingCollapsed">
            <span>思考过程</span>
            <span class="wb-stream-state">{{ streamStateLabel }}</span>
            <span class="wb-stream-caret">{{ thinkingCollapsed ? '▸' : '▾' }}</span>
          </button>
          <div v-show="!thinkingCollapsed" ref="thinkingBodyRef" class="wb-stream-body">
            <pre class="wb-stream-text">{{ thinking?.trim() || (generating ? '等待模型返回思考过程…' : '暂无思考过程') }}</pre>
          </div>
        </div>
        <div v-if="generationMessage" class="wb-stream-note" :class="generationState">
          {{ generationMessage }}
        </div>
        <textarea class="wb-textarea wb-code" :value="script" placeholder="点右上「生成」，或直接手写" @input="onScriptInput" />
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.wb-body { display: flex; align-items: stretch; height: 78vh; gap: 0; }
.wb-preview { display: flex; flex-direction: column; height: 78vh; min-width: 0; }
.wb-preview-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.wb-preview-head b { color: var(--rc-text); font-size: 13px; }
.wb-preview-actions { display: flex; align-items: center; gap: 10px; }
.wb-preview-actions span { color: var(--rc-faint); font-size: 11px; }
.wb-preview-textarea { flex: 1; min-height: 0; width: 100%; margin: 0; overflow: auto; padding: 14px; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; color: var(--rc-text); font-size: 13px; line-height: 1.7; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; resize: none; outline: none; box-sizing: border-box; }
.wb-preview-textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.wb-pane { display: flex; flex-direction: column; min-width: 0; }
.wb-pane-right { flex: 1 1 auto; }
.wb-pane-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.wb-pane-head b { font-size: 13px; color: var(--rc-text); flex-shrink: 0; }
.wb-state { flex: none; padding: 2px 8px; border-radius: 999px; background: #e8f0ff; color: #1d4ed8; font-size: 11px; font-weight: 700; }
.wb-category { width: 132px; flex: 0 0 132px; }
.wb-provider { width: 150px; flex-basis: 150px; }
.wb-model { width: 170px; flex-basis: 170px; }
.wb-help { margin: -2px 0 8px; color: var(--rc-faint); font-size: 11px; line-height: 1.4; }
.wb-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-faint); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.wb-pane-actions { display: flex; gap: 8px; flex-shrink: 0; }
.wb-stream { margin: 0 0 10px; border: 1px solid #1e293b; border-radius: 8px; overflow: hidden; background: #0b1220; }
.wb-stream-head { width: 100%; display: flex; align-items: center; gap: 8px; justify-content: space-between; padding: 8px 10px; border: 0; background: #111827; color: #e5eefc; font-size: 12px; font-weight: 700; cursor: pointer; text-align: left; }
.wb-stream-head span:first-child { flex: 1; }
.wb-stream-state { flex: none; color: #93c5fd; font-size: 11px; font-weight: 700; }
.wb-stream-caret { flex: none; color: #93c5fd; }
.wb-stream-body { max-height: 24vh; overflow-y: auto; padding: 10px; border-top: 1px solid #1e293b; }
.wb-stream-text { margin: 0; color: #cbd5e1; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.wb-stream-note { margin: 0 0 10px; padding: 8px 10px; border-radius: 8px; background: #ecfdf5; color: #047857; font-size: 12px; font-weight: 600; }
.wb-stream-note.done { background: #ecfdf5; color: #047857; }
.wb-stream-note.error { background: #fef2f2; color: #b91c1c; }
.wb-textarea { flex: 1; width: 100%; margin: 0; border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; color: var(--rc-text); font-size: 13px; line-height: 1.6; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 12px; outline: none; resize: none; box-sizing: border-box; }
.wb-textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.wb-describe { background: #f8fafc; color: var(--rc-text-2); cursor: default; }
.wb-describe:focus { border-color: #dbe3ee; box-shadow: none; }
.wb-code { background: #0f172a; color: #dbeafe; }
.wb-code:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #1e3a5f; }
.wb-splitter { flex: 0 0 10px; cursor: col-resize; position: relative; }
.wb-splitter::before { content: ''; position: absolute; left: 4px; top: 8px; bottom: 8px; width: 2px; border-radius: 2px; background: var(--rc-border-soft); }
.wb-splitter:hover::before, .wb-splitter:active::before { background: var(--rc-primary); }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 12px; border: 1px solid var(--rc-border); border-radius: 6px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:hover { border-color: #bfdbfe; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-btn.is-generating { width: 32px; padding: 0; }
.rc-stop-icon { display: block; width: 10px; height: 10px; border-radius: 1px; background: currentColor; }
</style>
