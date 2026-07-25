<script setup lang="ts">
// 节点配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 内容：决策/分头节点交给 BranchEditor；其余节点按 [基础 → 输入映射 → 规则编排 | 处理类参数] 分组纵向展示。
// 行为与原内联实现 1:1；规则资产 ruleOrchestrations 经 useNodeInspectorAssets 注入（懒加载由主壳负责）。
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import {
  WEB_KIND_OPTIONS, decisionOrParallelKind, makeDefaultRuleOrchestration, collectorCapabilityOf,
  type CollectConfig, type NodeConfig, type TripleField, type WebKind,
} from '@/views/FlowCanvas/canvas/flowModel'
import BranchEditor from '../BranchEditor.vue'
import CollectorSettings, { type CollectorRuntimeSettings } from '../CollectorSettings.vue'
import { ruleApi, type RuleOrchestration, type RuleOrchestrationTestResult } from '@/api'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'

const flow = useFlowStore()
const { ruleOrchestrations } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed<CollectConfig | undefined>(() => cfg.value?.collectCfg)

const isDecisionOrParallel = computed(() => !!cfg.value && decisionOrParallelKind(cfg.value) !== undefined)
const isRule = computed(() => /规则/.test(cfg.value?.title ?? ''))
const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))

// 采集节点运行设置（0711 R5）：代理/断点续爬/登录迁到节点级；缺省读一次 Source 同名旧字段兜底展示（1:1+fallback）
const runtimeSettings = computed<CollectorRuntimeSettings>(() => {
  const s = flow.sourceCfg
  return {
    useProxy: cc.value?.useProxy ?? s?.useProxy,
    resume: cc.value?.resume ?? s?.resume,
    needLogin: cc.value?.needLogin ?? s?.needLogin,
    loginUrl: cc.value?.loginUrl ?? s?.loginUrl,
    account: cc.value?.account ?? s?.account,
    credentialRef: cc.value?.credentialRef ?? s?.credentialRef,
    scheduleType: cc.value?.scheduleType ?? s?.scheduleType,
    scheduleTime: cc.value?.scheduleTime ?? s?.scheduleTime,
    weekdays: cc.value?.weekdays ?? s?.weekdays,
    cron: cc.value?.cron ?? s?.cron,
  }
})
function onRuntimeSettingsChange(patch: Partial<CollectorRuntimeSettings>) {
  flow.patchCollect(id.value, patch)
}

// 首采集节点判定：调度设置只在首采集节点展示（与原 NodeInspector 顶层逻辑一致）
const isFirstCollectorNode = computed(() => !!cc.value && flow.main.find((nodeId: string) => !!flow.configs[nodeId]?.collectCfg) === id.value)

// 主链上一个节点：用于输入映射「来源」下拉建议
const prevNode = computed<NodeConfig | undefined>(() => {
  const idx = flow.main.indexOf(id.value)
  for (let i = idx - 1; i >= 0; i--) {
    const pid = flow.main[i]
    if (pid === 'start') return undefined
    const c = flow.configs[pid]
    if (c) return c
  }
  return undefined
})
const inmapSourceOptions = computed(() => {
  const p = prevNode.value
  if (!p) return []
  return p.output.map((row) => `← ${p.title}.${row.name}`)
})

function onTripleCell(field: TripleField, i: number, col: 0 | 1 | 2, e: Event) {
  flow.setTripleCell(id.value, field, i, col, (e.target as HTMLInputElement).value)
}

function onTitle(e: Event) {
  flow.setTitle(id.value, (e.target as HTMLInputElement).value)
}
function setCC(key: string, e: Event) {
  const t = e.target as HTMLInputElement
  const val: string | boolean = t.type === 'checkbox' ? t.checked : t.value
  flow.patchCollect(id.value, { [key]: val } as Partial<CollectConfig>)
}
const isAppCollect = computed(() => Boolean(cc.value && /APP/.test(`${cfg.value?.title ?? ''}${cfg.value?.sub ?? ''}${cc.value.snatchType}`)))
const appPackageRowIndex = computed(() => cfg.value?.base.findIndex((row: [string, string]) => row[0] === '包名') ?? -1)
const appPackageName = computed(() => {
  const row = cfg.value?.base[appPackageRowIndex.value]
  return row?.[1] ?? ''
})
const collectUrlLabel = computed(() => (isAppCollect.value ? '接口地址' : '源 URL'))
const collectUrlPlaceholder = computed(() => (isAppCollect.value ? '如 https://m.example.com/api/list?page=${page}' : '如 https://example.com/list?page=${page}'))
function onAppPackageChange(e: Event) {
  if (appPackageRowIndex.value < 0) return
  flow.setBaseRow(id.value, appPackageRowIndex.value, (e.target as HTMLInputElement).value)
}
function onWebKind(e: Event) {
  flow.patchCollect(id.value, { webKind: (e.target as HTMLSelectElement).value as WebKind })
}

// ---- 规则处理节点：规则引擎编排面板（0707 Phase 9）----
const rulePromptOpen = ref(false)
const ruleGenerating = ref(false)
const ruleTesting = ref(false)
const ruleSaving = ref(false)
const ruleTestContent = ref('某地产公司发布重大事项公告')
const ruleTestResult = ref<RuleOrchestrationTestResult | null>(null)
const ruleCfg = computed<RuleOrchestration>(() => ({ ...makeDefaultRuleOrchestration(), ...cfg.value?.ruleCfg }))
const ruleTestResultText = computed(() =>
  ruleTestResult.value ? JSON.stringify(ruleTestResult.value.result ?? { error: ruleTestResult.value.error }, null, 2) : '',
)
function patchRuleCfg(patch: Partial<RuleOrchestration>) {
  flow.patchRuleConfig(id.value, patch)
  ruleTestResult.value = null
}
function onRuleModeChange(mode: RuleOrchestration['mode']) {
  patchRuleCfg({ mode })
}
function onRuleRefChange(e: Event) {
  const ruleId = (e.target as HTMLSelectElement).value
  const item = ruleOrchestrations.value.find((r) => r.ruleId === ruleId)
  if (!item) return
  patchRuleCfg({
    mode: 'ref',
    ruleId: item.ruleId,
    name: item.name,
    describe: item.describe,
    script: item.script,
    scriptPath: item.scriptPath,
    enabled: item.enabled,
  })
}
function onRuleDescribeChange(e: Event) {
  patchRuleCfg({ describe: (e.target as HTMLTextAreaElement).value })
}
function onRulePromptChange(e: Event) {
  patchRuleCfg({ systemPrompt: (e.target as HTMLTextAreaElement).value })
}
function onRuleTestContentChange(e: Event) {
  ruleTestContent.value = (e.target as HTMLTextAreaElement).value
}
async function onGenerateRuleScript() {
  if (!ruleCfg.value.describe.trim()) {
    ElMessage.warning('请先填写规则需求描述')
    return
  }
  ruleGenerating.value = true
  try {
    const res = await ruleApi.orchestrationGenerate(ruleCfg.value.describe, ruleCfg.value.systemPrompt)
    patchRuleCfg({ mode: 'new', script: res.script, scriptPath: res.scriptPath })
    ElMessage.success('脚本已生成')
  } finally {
    ruleGenerating.value = false
  }
}
async function onTestRuleScript() {
  if (!ruleCfg.value.script?.trim()) {
    ElMessage.warning('请先生成或选择脚本')
    return
  }
  ruleTesting.value = true
  try {
    const res = await ruleApi.orchestrationTest(ruleCfg.value.script, { content: ruleTestContent.value })
    ruleTestResult.value = res
    if (res.success) ElMessage.success('测试通过')
    else ElMessage.warning(res.error || '测试未通过')
  } finally {
    ruleTesting.value = false
  }
}
async function onSaveRuleScript() {
  if (!ruleCfg.value.script?.trim()) {
    ElMessage.warning('请先生成或选择脚本')
    return
  }
  try {
    await ElMessageBox.confirm('保存后将把当前规则编排绑定到该规则处理节点，是否继续？', '保存规则脚本', {
      type: 'warning',
      confirmButtonText: '确认保存',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  ruleSaving.value = true
  try {
    const res = await ruleApi.orchestrationSave(ruleCfg.value)
    patchRuleCfg({ mode: 'ref', ruleId: res.ruleId, scriptPath: res.scriptPath })
    ruleOrchestrations.value = (await ruleApi.orchestrationPaged({ size: 100 })).list
    ElMessage.success(res.message || '规则脚本已保存')
  } finally {
    ruleSaving.value = false
  }
}
</script>

<template>
  <!-- 节点配置：单屏纵向分组，无步进器 / 无子 Tab（0706 调整4）；
       决策/分头节点直接交给 BranchEditor 接管（0707 优化·Phase6） -->
  <BranchEditor v-if="isDecisionOrParallel && id" :owner-id="id" :key="id" />
  <template v-else>
    <div class="rc-field"><label>节点名称</label><input class="rc-input" :value="cfg?.title" @input="onTitle" /></div>

    <!-- 采集类专属：源 URL / 网页类型（详情状态由网页类型自动推导） -->
    <template v-if="cc">
      <div v-if="isAppCollect" class="rc-field"><label>APP 包名</label>
        <input class="rc-input" :value="appPackageName" placeholder="如 com.example.app" @input="onAppPackageChange" />
      </div>
      <div class="rc-field"><label>{{ collectUrlLabel }}</label>
        <div class="rc-input-group">
          <input class="rc-input" :value="cc.url" :placeholder="collectUrlPlaceholder" @input="setCC('url', $event)" />
          <button class="rc-input-action" type="button" title="复制" @click="ElMessage.info('复制链接（演示）')">复制</button>
          <button class="rc-input-action" type="button" title="打开" @click="ElMessage.info('打开链接（演示）')">↗</button>
        </div>
      </div>
      <div v-if="!isAppCollect" class="rc-field"><label>网页类型</label>
        <select class="rc-select" :value="cc.webKind" @change="onWebKind">
          <option v-for="kind in WEB_KIND_OPTIONS" :key="kind.value" :value="kind.value">
            {{ kind.label }} · {{ kind.desc }}
          </option>
        </select>
      </div>
      <!-- 运行设置（0711 R5）：代理/断点续爬/登录，节点级配置、默认折叠 -->
      <CollectorSettings :model-value="runtimeSettings" :capability="nodeCapability" :show-schedule="isFirstCollectorNode" @update:model-value="onRuntimeSettingsChange" />
    </template>

    <!-- 输入映射：只保留给处理/规则/AI 等非采集节点，采集节点避免与源配置和表配置重复 -->
    <template v-if="!cc">
      <div class="ni-section-title">输入映射</div>
      <table class="rc-mini-table rc-edit-table">
        <thead><tr><th>目标入参</th><th>来源</th><th>说明</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(row, i) in cfg?.inmap ?? []" :key="i">
            <td><input class="rc-cell-input" :value="row.name" @input="onTripleCell('inmap', i, 0, $event)" /></td>
            <td><input class="rc-cell-input" list="ni-inmap-src" :value="row.from" @input="onTripleCell('inmap', i, 1, $event)" /></td>
            <td><input class="rc-cell-input" :value="row.desc" @input="onTripleCell('inmap', i, 2, $event)" /></td>
            <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'inmap', i)">✕</button></td>
          </tr>
        </tbody>
      </table>
      <datalist id="ni-inmap-src">
        <option v-for="opt in inmapSourceOptions" :key="opt" :value="opt" />
      </datalist>
      <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'inmap')">+ 添加行</button>
      <div class="rc-help">把上游节点输出字段映射到本节点入参（对应采集平台"上一步属性"、AI 提取"输出映射"）。← 表示取自上游；"来源"输入框下拉建议取自上一节点的产物字段。</div>
    </template>

    <template v-if="!cc && isRule">
      <div class="ni-section-title">规则编排</div>
      <div class="rc-field"><label>规则来源</label>
        <div class="rc-segment">
          <button type="button" :class="{ active: ruleCfg.mode === 'ref' }" @click="onRuleModeChange('ref')">引用已有规则</button>
          <button type="button" :class="{ active: ruleCfg.mode === 'new' }" @click="onRuleModeChange('new')">新建编排</button>
        </div>
      </div>

      <div v-if="ruleCfg.mode === 'ref'" class="rc-field"><label>已有规则编排</label>
        <select class="rc-select" :value="ruleCfg.ruleId ?? ''" @change="onRuleRefChange">
          <option value="">选择规则编排</option>
          <option v-for="r in ruleOrchestrations" :key="r.ruleId" :value="r.ruleId">
            {{ r.ruleId }} · {{ r.name }}{{ r.enabled ? '' : '（停用）' }}
          </option>
        </select>
      </div>

      <div class="rc-field"><label>规则需求描述</label>
        <textarea
          class="rc-input rc-textarea"
          :readonly="ruleCfg.mode === 'ref'"
          :value="ruleCfg.describe"
          placeholder="描述规则处理逻辑，如 content 中包含地产二字时，tags 返回房地产"
          @input="onRuleDescribeChange"
        />
      </div>

      <div class="ni-adv">
        <button class="ni-adv-toggle" type="button" @click="rulePromptOpen = !rulePromptOpen">
          {{ rulePromptOpen ? '▾' : '▸' }} 系统提示词
        </button>
        <div v-if="rulePromptOpen" class="ni-adv-body">
          <textarea
            class="rc-input rc-textarea"
            :readonly="ruleCfg.mode === 'ref'"
            :value="ruleCfg.systemPrompt ?? ''"
            @input="onRulePromptChange"
          />
        </div>
      </div>

      <div class="rc-actions-row">
        <button class="rc-btn primary" type="button" :disabled="ruleGenerating || ruleCfg.mode === 'ref'" @click="onGenerateRuleScript">
          {{ ruleGenerating ? '生成中...' : '生成脚本' }}
        </button>
      </div>

      <div class="rc-list ni-rule-meta">
        <div class="rc-list-row"><b>脚本路径</b><span>{{ ruleCfg.scriptPath || '未生成' }}</span></div>
      </div>
      <textarea class="rc-code-box" readonly :value="ruleCfg.script || '生成脚本后展示 Python 预览；引用已有规则时展示已保存脚本。'" />

      <div class="ni-section-title">测试脚本</div>
      <div class="rc-field"><label>测试 content</label>
        <textarea class="rc-input rc-textarea" :value="ruleTestContent" @input="onRuleTestContentChange" />
      </div>
      <div class="rc-actions-row">
        <button class="rc-btn" type="button" :disabled="ruleTesting" @click="onTestRuleScript">
          {{ ruleTesting ? '测试中...' : '测试脚本' }}
        </button>
        <button class="rc-btn primary" type="button" :disabled="ruleSaving" @click="onSaveRuleScript">
          {{ ruleSaving ? '保存中...' : '保存脚本' }}
        </button>
      </div>
      <pre v-if="ruleTestResult" class="ni-json-box">{{ ruleTestResultText }}</pre>
    </template>

    <!-- 非采集类专属：原「基础/输入映射/参数/试跑」四子页，合并为单屏纵向分组（0706 调整4） -->
    <template v-if="!cc && !isRule">
      <div v-if="cfg?.planned" class="rc-drawer show">规划中节点：OCR / AI 提取 / 发邮件仍待执行器确认。配置可先草拟，发起抓取与上线需等待能力就绪。</div>

      <div v-for="(row, i) in cfg?.base ?? []" :key="row[0]" class="rc-field">
        <label>{{ row[0] }}</label>
        <input class="rc-input" :value="row[1]" @input="flow.setBaseRow(id, i, ($event.target as HTMLInputElement).value)" />
      </div>
      <div v-for="(row, i) in cfg?.fields ?? []" :key="row[0]" class="rc-field">
        <label>{{ row[0] }}</label>
        <input class="rc-input" :value="row[1]" @input="flow.setFieldRow(id, i, ($event.target as HTMLInputElement).value)" />
      </div>
      <div class="rc-help">字段随节点类型变化：网页抓取呈现源/配置/子步骤；规则处理呈现规则组/表达式/共享配置。</div>
      <div class="rc-actions-row"><button class="rc-btn" type="button" @click="flow.duplicate(id)">复制节点</button></div>

      <div class="ni-section-title">参数</div>
      <table class="rc-mini-table rc-edit-table">
        <thead><tr><th>字段/参数</th><th>类型</th><th>说明</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(row, i) in cfg?.params ?? []" :key="i">
            <td><input class="rc-cell-input" :value="row.name" @input="onTripleCell('params', i, 0, $event)" /></td>
            <td><input class="rc-cell-input" :value="row.type" @input="onTripleCell('params', i, 1, $event)" /></td>
            <td><input class="rc-cell-input" :value="row.desc" @input="onTripleCell('params', i, 2, $event)" /></td>
            <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'params', i)">✕</button></td>
          </tr>
        </tbody>
      </table>
      <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'params')">+ 添加行</button>
      <div class="rc-help">参数来自采集平台列表、日期或序列；发任务时弹出填写，并进入运行记录供审计与重跑。</div>

      <div class="ni-section-title">发起抓取信息</div>
      <div class="rc-list">
        <div class="rc-list-row"><b>发起抓取输入</b><span>使用最近 10 条样本</span></div>
        <div class="rc-list-row"><b>执行器</b><span>{{ cfg?.planned ? '待执行器确认' : '采集平台青龙 + 规则引擎' }}</span></div>
        <div class="rc-list-row"><b>执行方式</b><span>异步：发任务 → 轮询 L/C/E</span></div>
        <div class="rc-list-row"><b>最近结果</b><span>成功 8 / 失败 1 / 待复核 1</span></div>
      </div>
      <div class="rc-actions-row"><button class="rc-btn" type="button" @click="ElMessage.info('查看日志（演示占位）')">查看日志</button></div>
    </template>
  </template>
</template>

<style scoped>
.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-textarea { min-height: 74px; resize: vertical; line-height: 1.5; }
.rc-input-group { display: flex; align-items: stretch; width: 100%; }
.rc-input-group .rc-input { border-radius: 7px 0 0 7px; }
.rc-input-action { min-width: 36px; border: 1px solid #dbe3ee; border-left: 0; background: #fff; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.rc-input-action:last-child { border-radius: 0 7px 7px 0; }
.rc-input-action:hover { background: var(--rc-primary-bg); }
.rc-actions-row { display: flex; gap: 8px; margin-top: 12px; }
.rc-actions-row .rc-btn { height: 32px; padding: 0 11px; font-size: 12px; }
.rc-mini-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.rc-mini-table th { text-align: left; color: var(--rc-muted); font-weight: 600; padding: 6px 5px; border-bottom: 1px solid #eef2f7; }
.rc-mini-table td { padding: 7px 5px; border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text-2); }
.rc-edit-table th:last-child, .rc-edit-table td:last-child { width: 26px; padding: 4px 2px; }
.rc-cell-input { width: 100%; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--rc-text-2); font-size: 11px; padding: 4px 5px; outline: none; }
.rc-cell-input:hover { border-color: #dbe3ee; }
.rc-cell-input:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 2px #dbeafe; }
.rc-row-del { width: 20px; height: 20px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.rc-row-del:hover { background: var(--rc-error-bg); color: #b91c1c; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 7px 10px; font-size: 12px; cursor: pointer; }
.rc-segment button:first-child { border-left: 0; }
.rc-segment button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }
.ni-section-title { margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--rc-border-soft); color: var(--rc-muted); font-size: 12px; font-weight: 700; }
.ni-adv { margin-top: 12px; border-top: 1px dashed var(--rc-border-soft); padding-top: 8px; }
.ni-adv-toggle { border: 0; background: transparent; color: var(--rc-muted); font-size: 11px; font-weight: 600; cursor: pointer; padding: 2px 0; }
.ni-adv-toggle:hover { color: var(--rc-primary-ink); }
.ni-adv-body { margin-top: 8px; }
.rc-list { border: 1px solid #eef2f7; border-radius: 8px; overflow: hidden; }
.rc-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border-top: 1px solid #eef2f7; font-size: 11px; color: var(--rc-text-2); }
.rc-list-row:first-child { border-top: 0; }
.rc-list-row b { color: var(--rc-text); font-weight: 600; }
.ni-rule-meta { margin: 10px 0 8px; }
.ni-rule-meta span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rc-code-box, .ni-json-box { width: 100%; min-height: 112px; margin: 0; border: 1px solid #dbe3ee; border-radius: 8px; background: #0f172a; color: #dbeafe; font-size: 11px; line-height: 1.55; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding: 10px; overflow: auto; resize: vertical; }
.ni-json-box { min-height: 70px; margin-top: 10px; background: #f8fafc; color: var(--rc-text); }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.rc-drawer { margin-bottom: 12px; padding: 10px; border: 1px solid #bfdbfe; background: var(--rc-primary-bg); color: #1e40af; border-radius: 8px; font-size: 11px; line-height: 1.55; }
</style>
