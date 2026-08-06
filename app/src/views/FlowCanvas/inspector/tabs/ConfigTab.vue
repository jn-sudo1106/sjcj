<script setup lang="ts">
// 节点配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 内容：决策/分头 → BranchEditor；采集 → URL/运行设置；规则节点仅「节点名称」
// （表/字段在「表配置」，脚本在「编排配置」，见 RuleOrchestrationTab，0801 方案 §6.1）。
// 跨节点字段映射那块（inmap，原节点配置里的一段表格）已整块删除（0804 拍板：没什么用，见开发方案 §2.4）。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import {
  WEB_KIND_OPTIONS, decisionOrParallelKind, collectorCapabilityOf, isRuleNode,
  type CollectConfig, type CollectorSchedule, type NodeConfig, type TripleField, type WebKind,
} from '@/views/FlowCanvas/canvas/flowModel'
import { entryApi, ruleApi, type RuleOrchestrationItem } from '@/api'
import BranchEditor from '../BranchEditor.vue'
import CollectorSettings, { type CollectorRuntimeSettings } from '../CollectorSettings.vue'
import TaskScheduleSettings from '../TaskScheduleSettings.vue'
import ParamSourceEditor, { type ParamSourceModel } from '@/views/FlowCanvas/source/ParamSourceEditor.vue'
import EditParamSourceDialog from '@/views/FlowCanvas/source/EditParamSourceDialog.vue'
import SelectExistingRuleDialog from '../SelectExistingRuleDialog.vue'

// 参数子源（0803 调整）：本区域默认只读摘要，编辑收进「编辑」按钮弹出的 EditParamSourceDialog——
// 该弹窗保存走 sourceApi.sourceUpdate 落库，再 patchSource/patchSourceCtx 写回，
// patchSource 内部 applyParamSourceUrlToFirstCollectNode 会自动把首节点 cc.url / cc.urlParamRefs 同步好
// （见 flowModel.ts:401-408）；本文件不再直接双向绑定 model，只做一次性只读派生。

const flow = useFlowStore()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed<CollectConfig | undefined>(() => cfg.value?.collectCfg)

const isDecisionOrParallel = computed(() => !!cfg.value && decisionOrParallelKind(cfg.value) !== undefined)
const isRule = computed(() => isRuleNode(cfg.value))
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
  }
})
function onRuntimeSettingsChange(patch: Partial<CollectorRuntimeSettings>) {
  flow.patchCollect(id.value, patch)
}

const scheduleSettings = computed<CollectorSchedule>(() => {
  const s = flow.sourceCfg
  return {
    scheduleType: cfg.value?.schedule?.scheduleType ?? cc.value?.scheduleType ?? s?.scheduleType,
    scheduleTime: cfg.value?.schedule?.scheduleTime ?? cc.value?.scheduleTime ?? s?.scheduleTime,
    weekdays: cfg.value?.schedule?.weekdays ?? cc.value?.weekdays ?? s?.weekdays,
    cron: cfg.value?.schedule?.cron ?? cc.value?.cron ?? s?.cron,
  }
})
function onScheduleChange(patch: Partial<CollectorSchedule>) {
  flow.patchSchedule(id.value, patch)
}

// 首采集节点判定：调度设置只在首采集节点展示（与原 NodeInspector 顶层逻辑一致）。
// S4-1 追加登录节点后修正：登录节点也带 collectCfg，但它不是"真正意义上的采集起点"——
// 定时策略/参数子源这类"数据采集入口"专属配置得跳过登录节点，落在它后面第一个真正抓取数据的节点上，
// 否则流程排成"登录→列表抓取"后，这些配置会挂到登录节点上，列表抓取节点反而丢了。
function isRealCollectorNode(nodeId: string): boolean {
  const c = flow.configs[nodeId]
  return !!c?.collectCfg && collectorCapabilityOf(c)?.kind !== 'login'
}
const isFirstCollectorNode = computed(() => isRealCollectorNode(id.value) && flow.main.find(isRealCollectorNode) === id.value)

// 参数子源：仅首节点 + 源是参数子源（source.kind === 'param'）时展示只读摘要
const isParamSource = computed(() => flow.sourceCfg?.kind === 'param')
const showParamSourceEditor = computed(() => isFirstCollectorNode.value && isParamSource.value)
// 只读派生，不回写：编辑统一走「编辑」按钮打开的 EditParamSourceDialog
const paramSourceModel = computed<ParamSourceModel>(() => ({
  baseUrl: flow.sourceCfg?.baseUrl ?? '',
  urlTemplate: flow.sourceCfg?.urlTemplate ?? '',
  refs: (flow.sourceCfg?.paramRefs ?? []).map((ref) => ({ ...ref })),
}))
const editParamSourceVisible = ref(false)

function onTripleCell(field: TripleField, i: number, col: 0 | 1 | 2, e: Event) {
  flow.setTripleCell(id.value, field, i, col, (e.target as HTMLInputElement).value)
}

function onTitle(e: Event) {
  flow.setTitle(id.value, (e.target as HTMLInputElement).value)
}

// 选择已有规则（0805 恢复 D3 砍掉的能力，分开做：节点名称输入框只管"新建/改名"，
// 这个按钮 + 弹窗单独管"选"，见方案 §1.3 会议原话"新建是新建、选是选"）。
const selectExistingOpen = ref(false)
const applyingExisting = ref(false)
async function onSelectExistingRule(rule: RuleOrchestrationItem) {
  applyingExisting.value = true
  try {
    const detail = await ruleApi.orchestrationDetail(rule.ruleId)
    // 详情只带物理表名（inputTable），要反查成 entryType 的 tableId 才能跟 NodeConfig/表配置打通——
    // 现在表来源已经改回 entryApi（0805），直接按物理表名去搜，取第一个物理表名精确匹配的。
    let inputTableId = ''
    if (detail.inputTable) {
      try {
        const found = (await entryApi.entryPaged({ name: detail.inputTable, size: 20 })).list
          .find((t) => t.tableName === detail.inputTable)
        inputTableId = found?.tableId ?? ''
        if (!inputTableId) ElMessage.warning(`该规则原关联表「${detail.inputTable}」搜不到，请到「表配置」手动重新选择输入表`)
      } catch {
        ElMessage.warning('反查输入表失败，请到「表配置」手动重新选择输入表')
      }
    }
    flow.setTitle(id.value, detail.name || rule.name)
    flow.patchRuleConfig(id.value, {
      mode: 'ref',
      ruleId: detail.ruleId,
      describe: detail.describe,
      systemPrompt: detail.systemPrompt,
      scriptPath: detail.scriptPath,
      script: detail.script,
      enabled: detail.enabled,
      dataSource: detail.dataSource,
      inputTable: detail.inputTable,
      inputTableId,
      inputFields: detail.inputFields,
      outputFields: detail.outputFields,
      outputTable: '',
      outputTableId: '',
    })
    if (inputTableId) flow.setInputTable(id.value, inputTableId)
    ElMessage.success(`已选择规则「${detail.name || rule.name}」`)
  } catch (e) {
    ElMessage.error(`加载规则详情失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    applyingExisting.value = false
  }
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

// 业务类型（0804 S3-1）：规则名称维度的分类，跟网页类型（网页/APP、列表/详情/登录）是两个独立概念，别混——
// 会议原文举例"新闻/登录/分类"，先给这几个常见值，后续按实际使用再补
const BIZ_TYPE_OPTIONS = [
  { value: 'news', label: '新闻' },
  { value: 'login', label: '登录' },
  { value: 'category', label: '分类' },
  { value: 'announcement', label: '公告' },
]
function onBizType(e: Event) {
  flow.patchCollect(id.value, { bizType: (e.target as HTMLSelectElement).value || undefined })
}
</script>

<template>
  <!-- 节点配置：单屏纵向分组，无步进器 / 无子 Tab（0706 调整4）；
       决策/分头节点直接交给 BranchEditor 接管（0707 优化·Phase6） -->
  <BranchEditor v-if="isDecisionOrParallel && id" :owner-id="id" :key="id" />
  <template v-else>
    <div class="rc-field"><label>节点名称{{ isRule ? '（= 规则名称）' : '' }}</label>
      <div v-if="isRule" class="rc-input-group">
        <input class="rc-input" :value="cfg?.title" placeholder="新建：直接输入规则名称" @input="onTitle" />
        <button class="rc-input-btn" type="button" :disabled="applyingExisting" @click="selectExistingOpen = true">
          {{ applyingExisting ? '加载中...' : '选择已有' }}
        </button>
      </div>
      <input v-else class="rc-input" :value="cfg?.title" @input="onTitle" />
    </div>
    <details class="ni-schedule">
      <summary>定时策略</summary>
      <TaskScheduleSettings :model-value="scheduleSettings" @update:model-value="onScheduleChange" />
    </details>
    <SelectExistingRuleDialog v-if="isRule" v-model:open="selectExistingOpen" @select="onSelectExistingRule" />

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
      <!-- 登录节点专属（S4-1，方案 §6.1）：账号/凭据是节点自己的核心字段，常显不折叠——
           跟采集节点运行设置里已废弃的 needLogin 开关（CollectorSettings.vue）不是一回事，别混 -->
      <template v-if="nodeCapability?.kind === 'login'">
        <div class="rc-field"><label>登录账号</label>
          <input class="rc-input" :value="cc.account" placeholder="登录用户名" @input="setCC('account', $event)" />
        </div>
        <div class="rc-field"><label>凭据引用</label>
          <input class="rc-input" :value="cc.credentialRef" placeholder="凭据中心的引用 ID" @input="setCC('credentialRef', $event)" />
        </div>
      </template>
      <div v-if="!isAppCollect" class="rc-field"><label>网页类型</label>
        <select class="rc-select" :value="cc.webKind" @change="onWebKind">
          <option v-for="kind in WEB_KIND_OPTIONS" :key="kind.value" :value="kind.value">
            {{ kind.label }} · {{ kind.desc }}
          </option>
        </select>
      </div>
      <!-- 业务类型（0804 S3-1）：跟上面的网页类型是两个独立字段，不要合并 -->
      <div class="rc-field"><label>业务类型</label>
        <select class="rc-select" :value="cc.bizType ?? ''" @change="onBizType">
          <option value="">请选择</option>
          <option v-for="opt in BIZ_TYPE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <!-- 参数子源（0803 调整）：默认只读摘要，点「编辑」打开 EditParamSourceDialog 修改；
           仅首节点 + 源是参数子源时展示，详见上方脚本注释 -->
      <template v-if="showParamSourceEditor">
        <div class="ni-section-title ni-section-title-row">
          <span>参数子源</span>
          <button class="rc-btn" type="button" data-testid="param-source-edit-open" @click="editParamSourceVisible = true">编辑</button>
        </div>
        <div class="rc-section-divider">
          <ParamSourceEditor :model-value="paramSourceModel" readonly />
        </div>
        <EditParamSourceDialog v-model="editParamSourceVisible" />
      </template>
      <!-- 运行设置（0711 R5）：只保留代理/断点续爬；定时策略已独立到上方节点配置。 -->
      <CollectorSettings :model-value="runtimeSettings" :capability="nodeCapability" @update:model-value="onRuntimeSettingsChange" />
    </template>

    <!-- 非采集非规则：基础字段 / 参数 / 试跑信息 -->
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
.rc-input-btn { white-space: nowrap; padding: 0 12px; border: 1px solid #dbe3ee; border-left: 0; border-radius: 0 7px 7px 0; background: #fff; color: var(--rc-primary); cursor: pointer; font-size: 12px; font-weight: 600; }
.rc-input-btn:hover { background: var(--rc-primary-bg); }
.rc-input-btn:disabled { opacity: 0.5; cursor: not-allowed; }
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
.ni-section-title { margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--rc-border-soft); color: var(--rc-muted); font-size: 12px; font-weight: 700; }
.ni-section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ni-section-title-row .rc-btn { height: 24px; padding: 0 9px; font-size: 11px; }
.ni-schedule { margin: 10px 0 12px; border-top: 1px dashed var(--rc-border-soft); padding-top: 8px; }
.ni-schedule summary { color: var(--rc-muted); font-size: 11px; font-weight: 600; cursor: pointer; }
.ni-schedule[open] summary { color: var(--rc-primary-ink); margin-bottom: 8px; }
/* 参数子源编辑器容器（0802）：跟其他段落用同色背景区分；ParamSourceEditor 是 display:contents，外层负责间距 */
.rc-section-divider { margin-top: 4px; padding: 8px 10px; background: #f8fafc; border: 1px solid var(--rc-border-soft); border-radius: 7px; }
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
