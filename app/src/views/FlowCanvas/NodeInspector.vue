<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { useRuntimeStore } from '../../stores/runtime'
import { CONFIG_STRATEGY_OPTIONS, WEB_KIND_OPTIONS, type CollectConfig, type NodeConfig, type WebKind } from './flowModel'
import {
  entryApi, paramApi, configApi, sourceApi, ruleApi, dataApi,
  type EntryType, type Param, type Config, type CredentialRef, type RuleGroup, type Rule, type SharedConfig,
  type DataTableMeta, type DataRow,
} from '../../api'
import DataGrid from './DataGrid.vue'
import TableEditDialog from './TableEditDialog.vue'
import TableDataDialog from './TableDataDialog.vue'

const flow = useFlowStore()
const runtime = useRuntimeStore()
const cfg = computed(() => flow.selectedNode)
const id = computed(() => flow.selectedId)
const tab = computed(() => flow.activeTab)
const cc = computed(() => cfg.value?.collectCfg)

const statusText = computed(() => (cfg.value?.disabled ? '已停用' : (cfg.value?.status ?? '')))
const statusClass = computed(() => (cfg.value?.disabled || cfg.value?.planned ? 'warn' : 'ok'))

const STEPS: [string, string, string][] = [
  ['source', '1', '源配置'],
  ['table', '2', '表配置'],
  ['login', '3', '登录配置'],
  ['finish', '4', '完成'],
]
const NODE_TABS: [string, string][] = [
  ['base', '基础'], ['inmap', '输入映射'], ['params', '参数'], ['output', '产物'], ['run', '试跑'],
]
const WEEKDAYS: [number, string][] = [[1, '周一'], [2, '周二'], [3, '周三'], [4, '周四'], [5, '周五'], [6, '周六'], [7, '周日']]

// 资产联动数据
const tables = ref<EntryType[]>([])
const params = ref<Param[]>([])
const configs = ref<Config[]>([])
const cred = ref<CredentialRef | null>(null)
const ruleGroups = ref<RuleGroup[]>([])
const rules = ref<Rule[]>([])
const sharedCfgs = ref<SharedConfig[]>([])
const isRule = computed(() => /规则/.test(cfg.value?.title ?? ''))

onMounted(async () => {
  tables.value = (await entryApi.entryPaged({ size: 100 })).list
  params.value = (await paramApi.paramPaged({ size: 100 })).list
  configs.value = (await configApi.configPaged({ size: 100 })).list
  ruleGroups.value = await ruleApi.ruleGroups()
  rules.value = (await ruleApi.rulePaged({ size: 100 })).list
  sharedCfgs.value = await ruleApi.sharedConfigs()
})
watch(
  () => cc.value?.credentialRef,
  async (refId) => {
    cred.value = refId ? await sourceApi.credentialRef(refId) : null
  },
  { immediate: true },
)

const selectedTable = computed(() => tables.value.find((t) => t.tableId === cc.value?.outputTable) ?? null)

// ---- 输入映射「来源」下拉建议（Phase 3.1）：取主链路上一个节点的产物字段 ----
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
  return p.output.map((row) => `← ${p.title}.${row[0]}`)
})
function onTripleCell(field: 'inmap' | 'params' | 'output', i: number, col: 0 | 1 | 2, e: Event) {
  flow.setTripleCell(id.value, field, i, col, (e.target as HTMLInputElement).value)
}

// ---- 数据表编辑弹窗（T2）----
const tableDlg = reactive<{ open: boolean; tableId: string }>({ open: false, tableId: '' })
function openNewTable() {
  tableDlg.tableId = ''
  tableDlg.open = true
}
function openEditTable() {
  if (!cc.value?.outputTable) {
    ElMessage.info('请先选择一个输出表，或点「＋」新建')
    return
  }
  tableDlg.tableId = cc.value.outputTable
  tableDlg.open = true
}
async function onTableSaved(tableId: string) {
  tables.value = (await entryApi.entryPaged({ size: 100 })).list
  if (id.value) flow.patchCollect(id.value, { outputTable: tableId })
  loadPreview()
}

// 查看全部数据弹窗
const dataDlg = reactive<{ open: boolean }>({ open: false })
function openDataDialog() {
  if (!cc.value?.outputTable) return
  dataDlg.open = true
}

// ---- 表配置内联数据预览（Phase 5 / 方案 A）----
const previewMeta = ref<DataTableMeta | null>(null)
const previewRows = ref<DataRow[]>([])
const previewLoading = ref(false)
const mergedPreviewRows = computed<DataRow[]>(() => {
  const tid = cc.value?.outputTable
  const trial = (tid && runtime.dataByTable[tid]) || []
  // 试跑产出叠在最前
  return [...trial, ...previewRows.value]
})
async function loadPreview() {
  const tid = cc.value?.outputTable
  if (!tid) {
    previewMeta.value = null
    previewRows.value = []
    return
  }
  previewLoading.value = true
  try {
    // schema 优先取实体表（编排者常用），退而求 dataApi 表元
    const entry = selectedTable.value
    if (entry) {
      previewMeta.value = {
        tableId: entry.tableId,
        tableName: entry.tableName,
        rowCount: entry.rowCount ?? 0,
        fields: entry.fields.map((f) => ({ prop: f.prop, type: f.type, desc: f.desc, sample: '' })),
      }
    } else {
      previewMeta.value = await dataApi.tableMeta(tid)
    }
    const res = await dataApi.rowQueryPaged({ tableId: tid, page: 1, size: 5 })
    previewRows.value = res?.list ?? []
  } finally {
    previewLoading.value = false
  }
}
watch(
  () => [cc.value?.outputTable, tab.value, id.value] as const,
  ([tid, tb]) => {
    if (tb === 'table' && tid) loadPreview()
  },
  { immediate: true },
)
function paramName(pid: string) {
  return params.value.find((p) => p.paramId === pid)?.name ?? pid
}

function onTitle(e: Event) {
  flow.setTitle(id.value, (e.target as HTMLInputElement).value)
}
function setCC(key: string, e: Event) {
  const t = e.target as HTMLInputElement
  const val: string | boolean = t.type === 'checkbox' ? t.checked : t.value
  flow.patchCollect(id.value, { [key]: val } as Partial<CollectConfig>)
}
function setWebKind(kind: WebKind) {
  flow.patchCollect(id.value, { webKind: kind })
}
function onWebKind(e: Event) {
  setWebKind((e.target as HTMLSelectElement).value as WebKind)
}
function toggleDetail(e: Event) {
  flow.patchCollect(id.value, { isDetail: (e.target as HTMLInputElement).checked })
}
function addParam(e: Event) {
  const sel = e.target as HTMLSelectElement
  const v = sel.value
  const cur = cc.value?.inputParams ?? []
  if (v && !cur.includes(v)) flow.patchCollect(id.value, { inputParams: [...cur, v] })
  sel.value = ''
}
function removeParam(p: string) {
  flow.patchCollect(id.value, { inputParams: (cc.value?.inputParams ?? []).filter((x) => x !== p) })
}
function toggleWeekday(d: number) {
  const cur = cc.value?.weekdays ?? []
  const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()
  flow.patchCollect(id.value, { weekdays: next })
}

const confirmRows = computed<[string, string][]>(() => {
  const c = cc.value
  if (!c) return []
  return [
    ['节点名称', cfg.value?.title || c.sourceName || '—'],
    ['源 URL', c.url || '—'],
    ['输出表', selectedTable.value ? selectedTable.value.tableName : c.outputTable || '—'],
    ['配置方式', c.configMode === 'new' ? `新建配置 · ${c.configName || '未命名'}（${c.configStrategy}）` : `使用已有 ${c.configId}`],
    ['登录', c.needLogin ? '要求登陆' : '免登录'],
    ['定时', c.cron || '—'],
    ['源分类', c.category || '—'],
  ]
})

async function confirmDanger(title: string, body: string, run: () => Promise<{ message?: string }>) {
  try {
    await ElMessageBox.confirm(body, title, { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  const res = await run()
  ElMessage.success(res?.message || '操作已提交（演示）')
}
function onSaveDraft() {
  ElMessage.success('节点配置草稿已保存（演示，编辑已实时写入画布）')
}
function onSubmit() {
  const name = cfg.value?.title || cc.value?.sourceName || '当前节点'
  confirmDanger('保存节点配置', `将「${name}」的配置保存到当前流程，是否继续？（整条流程发布后才成为采集源）`, () =>
    sourceApi.generateConfig(id.value),
  )
}
// 单节点试跑：走 runtime 真闭环（画布该节点 L→C + 按其 outputTable 落表），与顶部整链试跑一致
function onTrial() {
  if (cfg.value?.planned) {
    ElMessage.info('规划中节点：待执行器就绪后可试跑')
    return
  }
  if (runtime.running) {
    ElMessage.warning('已有试跑正在进行，请稍候')
    return
  }
  const runId = runtime.trialNode(flow.serialize(), id.value)
  if (!runId) {
    ElMessage.warning('该节点当前不可试跑（已停用，或采集节点缺 URL / 输出表）')
    return
  }
  ElMessage.success(`已发起「${cfg.value?.title}」单节点试跑 ${runId}，画布状态流转中 → 运行记录 / 数据查看`)
}
</script>

<template>
  <div class="rc-inspector">
    <template v-if="cfg">
    <div class="rc-insp-head">
      <div>
        <div class="rc-insp-title">{{ cfg.title }}</div>
        <div class="rc-insp-sub">{{ cfg.sub }}</div>
      </div>
      <span class="rc-status" :class="statusClass">{{ statusText }}</span>
    </div>

    <div class="rc-inspector-body">
      <!-- 采集类：四步方块向导 -->
      <template v-if="cc">
        <div class="rc-stepper">
          <button
            v-for="s in STEPS"
            :key="s[0]"
            type="button"
            class="rc-step"
            :class="{ active: tab === s[0] }"
            @click="flow.setActiveTab(s[0])"
          >
            <b>{{ s[1] }} {{ s[2] }}</b>
          </button>
        </div>

        <!-- 步骤 1 源配置 -->
        <template v-if="tab === 'source'">
          <div class="rc-field"><label>节点名称</label><input class="rc-input" :value="cfg.title" @input="onTitle" /></div>
          <div class="rc-field"><label>源 URL</label>
            <div class="rc-input-group">
              <input class="rc-input" :value="cc.url" @input="setCC('url', $event)" />
              <button class="rc-input-action" type="button" title="复制" @click="ElMessage.info('复制链接（演示）')">复制</button>
              <button class="rc-input-action" type="button" title="打开" @click="ElMessage.info('打开链接（演示）')">↗</button>
            </div>

          </div>
          <div class="rc-field"><label>网页类型</label>
            <select class="rc-select" :value="cc.webKind" @change="onWebKind">
              <option v-for="kind in WEB_KIND_OPTIONS" :key="kind.value" :value="kind.value">
                {{ kind.label }} · {{ kind.desc }}
              </option>
            </select>
          </div>
          <div class="rc-field"><label>源名称</label><input class="rc-input" :value="cc.sourceName" @input="setCC('sourceName', $event)" /></div>
          <div class="rc-field"><label>源分类</label>
            <div class="rc-dir-picker">
              <div class="rc-dir-top">
                <input class="rc-input slim" :value="cc.dirId" @input="setCC('dirId', $event)" placeholder="目录 ID" />
                <button class="rc-btn primary" type="button" @click="ElMessage.info('选目录（演示占位）')">选目录</button>
                <input class="rc-input slim" :value="cc.category" @input="setCC('category', $event)" placeholder="目录名" />
              </div>
              <div class="rc-dir-tree">
                <div class="rc-dir-node">＋ 9008845 数据采集</div>
                <div class="rc-dir-node">　＋ 9009001 研报</div>
                <div class="rc-dir-node" :class="{ active: cc.dirId === '9009245' }">　└ 9009245 公告 / 交易所 / 列表</div>
                <div class="rc-dir-node">　└ 9009302 新闻 / 舆情</div>
              </div>
            </div>
          </div>
          <div class="rc-field"><label>核心参数</label>
            <div class="rc-checks">
              <label class="rc-check"><input type="checkbox" :checked="cc.useProxy" @change="setCC('useProxy', $event)" /> 使用代理</label>
              <label class="rc-check"><input type="checkbox" :checked="cc.resume" @change="setCC('resume', $event)" /> 断点续爬</label>
            </div>
          </div>
          <div class="rc-field"><label>定时策略</label>
            <div class="rc-scheduler">
              <div class="rc-scheduler-head">
                <select class="rc-select" :value="cc.scheduleType" @change="setCC('scheduleType', $event)">
                  <option v-for="s in ['交易日定时', '每天', '每小时', '每周', '自定义 cron']" :key="s" :value="s">{{ s }}</option>
                </select>
                <input class="rc-input" type="time" :value="cc.scheduleTime" @input="setCC('scheduleTime', $event)" />
              </div>
              <div class="rc-weekdays">
                <span v-for="[d, label] in WEEKDAYS" :key="d" class="rc-day" :class="{ active: cc.weekdays.includes(d) }" @click="toggleWeekday(d)">{{ label }}</span>
              </div>
              <div class="rc-cron-preview"><span>cron 表达式</span><input class="rc-input slim cron" :value="cc.cron" @input="setCC('cron', $event)" /></div>
            </div>
          </div>
          <div class="rc-field"><label>标签</label><input class="rc-input" :value="cc.tags" @input="setCC('tags', $event)" /></div>
          <div class="rc-actions-row"><button class="rc-btn primary" type="button" @click="flow.setActiveTab('table')">下一步</button></div>
        </template>

        <!-- 步骤 2 表配置 -->
        <template v-else-if="tab === 'table'">
          <div class="rc-field"><label>选用配置</label>
            <div class="rc-segment">
              <button type="button" :class="{ active: cc.configMode === 'new' }" @click="flow.patchCollect(id, { configMode: 'new' })">新建配置</button>
              <button type="button" :class="{ active: cc.configMode === 'existing' }" @click="flow.patchCollect(id, { configMode: 'existing' })">使用已有配置</button>
            </div>
          </div>
          <div v-if="cc.configMode === 'existing'" class="rc-field"><label>使用配置</label>
            <select class="rc-select" :value="cc.configId" @change="setCC('configId', $event)">
              <option v-for="c in configs" :key="c.configId" :value="c.configId">{{ c.configId }} · {{ c.name }}</option>
            </select>
          </div>
          <template v-else>
            <div class="rc-field"><label>配置名称</label><input class="rc-input" :value="cc.configName" @input="setCC('configName', $event)" placeholder="例如：交易所公告列表配置" /></div>
            <div class="rc-field"><label>Topic</label><input class="rc-input" :value="cc.configTopic" @input="setCC('configTopic', $event)" placeholder="例如：announcement.list" /></div>
            <div class="rc-field"><label>运行策略</label>
              <select class="rc-select" :value="cc.configStrategy" @change="setCC('configStrategy', $event)">
                <option v-for="s in CONFIG_STRATEGY_OPTIONS" :key="s" :value="s">{{ s }}</option>
              </select>
            </div>
          </template>
          <div class="rc-field"><label>新建模板选项</label>
            <div class="rc-checks">
              <label class="rc-check"><input type="checkbox" :checked="cc.isDetail" @change="toggleDetail" /> 详情类数据</label>
              <label class="rc-check"><input type="checkbox" :checked="cc.isLogin" @change="setCC('isLogin', $event)" /> 设本配置为登陆类</label>
            </div>
          </div>
          <div class="rc-field"><label>输出表</label>
            <div class="rc-input-group">
              <select class="rc-select grow" :value="cc.outputTable" @change="setCC('outputTable', $event)">
                <option v-for="t in tables" :key="t.tableId" :value="t.tableId">{{ t.tableId }} · {{ t.tableName }}</option>
              </select>
              <button class="rc-icon-btn" type="button" title="查看 / 编辑表" @click="openEditTable">?</button>
              <button class="rc-icon-btn" type="button" title="新建表" @click="openNewTable">＋</button>
            </div>
          </div>
          <div class="rc-field"><label>输入参数[多选]</label>
            <div class="rc-input-group">
              <select class="rc-select grow" value="" @change="addParam">
                <option value="">选择参数</option>
                <option v-for="p in params" :key="p.paramId" :value="p.paramId">{{ p.name }} · {{ p.kind }}</option>
              </select>
            </div>
            <div v-if="cc.inputParams.length" class="rc-tagchips">
              <span v-for="p in cc.inputParams" :key="p" class="rc-tagchip">{{ paramName(p) }} <i @click="removeParam(p)">✕</i></span>
            </div>
          </div>
          <div v-if="selectedTable" class="rc-table-detail">
            <div class="rc-table-detail-grid">
              <b>表ID</b><span>{{ selectedTable.tableId }}</span><b>表名称</b><span>{{ selectedTable.tableName }}</span>
              <b>行数</b><span>{{ (selectedTable.rowCount ?? 0).toLocaleString() }}</span><b>字段数</b><span>{{ selectedTable.fields.length }}</span>
            </div>
            <table class="rc-mini-table">
              <thead><tr><th>属性</th><th>中文</th><th>去重</th></tr></thead>
              <tbody><tr v-for="f in selectedTable.fields" :key="f.prop"><td>{{ f.prop }}</td><td>{{ f.desc }}</td><td>{{ f.dedup ? '✓' : '—' }}</td></tr></tbody>
            </table>
          </div>

          <!-- 数据预览：未绑表 / 已绑表 / 试跑叠加 三态 -->
          <div class="ni-preview">
            <div class="ni-preview-head">
              <b>数据预览</b>
              <span v-if="cc.outputTable && runtime.dataByTable[cc.outputTable]?.length" class="ni-preview-tag">含试跑样例</span>
              <button v-if="cc.outputTable" class="ni-preview-more" type="button" @click="openDataDialog">查看全部 ›</button>
            </div>
            <div v-if="!cc.outputTable" class="ni-preview-empty">
              请先在上方选择或创建输出表，确定后将在此查看该表的字段与样例数据。
            </div>
            <DataGrid
              v-else
              compact
              :meta="previewMeta"
              :rows="mergedPreviewRows"
              :loading="previewLoading"
            />
          </div>

          <div class="rc-actions-row"><button class="rc-btn primary" type="button" @click="flow.setActiveTab('login')">下一步</button><button class="rc-btn" type="button" @click="flow.setActiveTab('source')">上一步</button></div>
        </template>

        <!-- 步骤 3 登录配置 -->
        <template v-else-if="tab === 'login'">
          <div class="rc-field"><label>是否要求登陆</label>
            <div class="rc-segment">
              <button type="button" :class="{ active: !cc.needLogin }" @click="flow.patchCollect(id, { needLogin: false })">不登陆</button>
              <button type="button" :class="{ active: cc.needLogin }" @click="flow.patchCollect(id, { needLogin: true })">要求登陆</button>
            </div>
          </div>
          <template v-if="cc.needLogin">
            <div class="rc-field"><label>登陆URL</label><input class="rc-input" :value="cc.loginUrl" @input="setCC('loginUrl', $event)" /></div>
            <div class="rc-field"><label>登陆用户名</label><input class="rc-input" :value="cc.account" @input="setCC('account', $event)" /></div>
            <div class="rc-field"><label>登录凭据（只存引用，明文不回显）</label>
              <div class="rc-cred">
                <span v-if="cred">{{ cred.name }} · {{ cred.account }}</span>
                <span v-else class="rc-cred-empty">未绑定凭据</span>
              </div>
            </div>
          </template>
          <div class="rc-actions-row"><button class="rc-btn primary" type="button" @click="flow.setActiveTab('finish')">下一步</button><button class="rc-btn" type="button" @click="flow.setActiveTab('table')">上一步</button></div>
        </template>

        <!-- 步骤 4 完成 -->
        <template v-else>
          <div class="rc-confirm-card">
            <div class="rc-confirm-title">节点配置确认</div>
            <div class="rc-list"><div v-for="r in confirmRows" :key="r[0]" class="rc-list-row"><b>{{ r[0] }}</b><span>{{ r[1] }}</span></div></div>
            <div class="rc-confirm-actions"><button class="rc-btn primary" type="button" @click="onSubmit">保存节点</button><button class="rc-btn" type="button" @click="onTrial">试跑此节点</button><button class="rc-btn" type="button" @click="onSaveDraft">保存草稿</button><button class="rc-btn" type="button" @click="flow.setActiveTab('login')">上一步</button></div>
          </div>
        </template>
      </template>

      <!-- 非采集类：五子页 -->
      <template v-else>
        <div class="rc-inspector-tabs">
          <button v-for="t in NODE_TABS" :key="t[0]" type="button" :class="{ active: tab === t[0] }" @click="flow.setActiveTab(t[0])">{{ t[1] }}</button>
        </div>

        <div v-if="cfg.planned" class="rc-drawer show">规划中节点：OCR / AI 提取 / 发邮件仍待执行器确认。配置可先草拟，试跑与上线需等待能力就绪。</div>

        <template v-if="tab === 'base'">
          <div class="rc-field"><label>节点名称</label><input class="rc-input" :value="cfg.title" @input="onTitle" /></div>
          <div v-for="(row, i) in cfg.base" :key="row[0]" class="rc-field">
            <label>{{ row[0] }}</label>
            <select v-if="isRule && row[0] === '规则组'" class="rc-select" :value="row[1]" @change="flow.setBaseRow(id, i, ($event.target as HTMLSelectElement).value)">
              <option v-if="row[1] && !ruleGroups.some((g) => g.name === row[1])" :value="row[1]">{{ row[1] }}（当前）</option>
              <option v-for="g in ruleGroups" :key="g.id" :value="g.name">{{ g.name }} · {{ g.stage }}</option>
            </select>
            <input v-else class="rc-input" :value="row[1]" @input="flow.setBaseRow(id, i, ($event.target as HTMLInputElement).value)" />
          </div>
          <div v-for="(row, i) in cfg.fields" :key="row[0]" class="rc-field">
            <label>{{ row[0] }}</label>
            <select v-if="isRule && row[0] === '表达式'" class="rc-select" :value="row[1]" @change="flow.setFieldRow(id, i, ($event.target as HTMLSelectElement).value)">
              <option v-if="row[1] && !rules.some((r) => r.name === row[1])" :value="row[1]">{{ row[1] }}（当前）</option>
              <option v-for="r in rules" :key="r.ruleId" :value="r.name">{{ r.name }}</option>
            </select>
            <select v-else-if="isRule && row[0] === '共享配置'" class="rc-select" :value="row[1]" @change="flow.setFieldRow(id, i, ($event.target as HTMLSelectElement).value)">
              <option v-if="row[1] && !sharedCfgs.some((s) => s.name === row[1])" :value="row[1]">{{ row[1] }}（当前）</option>
              <option v-for="s in sharedCfgs" :key="s.id" :value="s.name">{{ s.name }}</option>
            </select>
            <input v-else class="rc-input" :value="row[1]" @input="flow.setFieldRow(id, i, ($event.target as HTMLInputElement).value)" />
          </div>
          <div class="rc-help">右侧随节点类型变化：网页抓取呈现源/配置/子步骤；规则处理呈现规则组/表达式/共享配置。</div>
          <div class="rc-actions-row"><button class="rc-btn primary" type="button" @click="onSaveDraft">保存配置草稿</button><button class="rc-btn" type="button" @click="flow.duplicate(id)">复制节点</button></div>
        </template>

        <template v-else-if="tab === 'inmap'">
          <table class="rc-mini-table rc-edit-table">
            <thead><tr><th>目标入参</th><th>来源</th><th>说明</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in cfg.inmap" :key="i">
                <td><input class="rc-cell-input" :value="row[0]" @input="onTripleCell('inmap', i, 0, $event)" /></td>
                <td><input class="rc-cell-input" list="ni-inmap-src" :value="row[1]" @input="onTripleCell('inmap', i, 1, $event)" /></td>
                <td><input class="rc-cell-input" :value="row[2]" @input="onTripleCell('inmap', i, 2, $event)" /></td>
                <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'inmap', i)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <datalist id="ni-inmap-src">
            <option v-for="opt in inmapSourceOptions" :key="opt" :value="opt" />
          </datalist>
          <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'inmap')">+ 添加行</button>
          <div class="rc-help">把上游节点输出字段映射到本节点入参（对应采集平台“上一步属性”、AI 提取“输出映射”）。← 表示取自上游；「来源」输入框下拉建议取自上一节点的产物字段。</div>
        </template>

        <template v-else-if="tab === 'params'">
          <table class="rc-mini-table rc-edit-table">
            <thead><tr><th>字段/参数</th><th>类型</th><th>说明</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in cfg.params" :key="i">
                <td><input class="rc-cell-input" :value="row[0]" @input="onTripleCell('params', i, 0, $event)" /></td>
                <td><input class="rc-cell-input" :value="row[1]" @input="onTripleCell('params', i, 1, $event)" /></td>
                <td><input class="rc-cell-input" :value="row[2]" @input="onTripleCell('params', i, 2, $event)" /></td>
                <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'params', i)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'params')">+ 添加行</button>
          <div class="rc-help">参数来自采集平台列表、日期或序列；发任务时弹出填写，并进入运行记录供审计与重跑。</div>
        </template>

        <template v-else-if="tab === 'output'">
          <div class="rc-field"><label>落表绑定（可选，选定后可在结果视图查看该节点数据）</label>
            <select class="rc-select" :value="cfg.outputTable ?? ''" @change="flow.setOutputTable(id, ($event.target as HTMLSelectElement).value)">
              <option value="">不绑定输出表</option>
              <option v-for="t in tables" :key="t.tableId" :value="t.tableId">{{ t.tableId }} · {{ t.tableName }}</option>
            </select>
          </div>
          <table class="rc-mini-table rc-edit-table">
            <thead><tr><th>产物</th><th>类型</th><th>说明</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(row, i) in cfg.output" :key="i">
                <td><input class="rc-cell-input" :value="row[0]" @input="onTripleCell('output', i, 0, $event)" /></td>
                <td><input class="rc-cell-input" :value="row[1]" @input="onTripleCell('output', i, 1, $event)" /></td>
                <td><input class="rc-cell-input" :value="row[2]" @input="onTripleCell('output', i, 2, $event)" /></td>
                <td><button class="rc-row-del" type="button" title="删除该行" @click="flow.removeTripleRow(id, 'output', i)">✕</button></td>
              </tr>
            </tbody>
          </table>
          <button class="rc-btn" type="button" @click="flow.addTripleRow(id, 'output')">+ 添加行</button>
          <div class="rc-help">输出进入实体表/原始文件/规则 Trace/邮件审计，经 run_id 供 Skill Run 追溯。</div>
        </template>

        <template v-else>
          <div class="rc-list">
            <div class="rc-list-row"><b>试跑输入</b><span>使用最近 10 条样本</span></div>
            <div class="rc-list-row"><b>执行器</b><span>{{ cfg.planned ? '待执行器确认' : '采集平台青龙 + 规则引擎' }}</span></div>
            <div class="rc-list-row"><b>执行方式</b><span>异步：发任务 → 轮询 L/C/E</span></div>
            <div class="rc-list-row"><b>最近结果</b><span>成功 8 / 失败 1 / 待复核 1</span></div>
          </div>
          <div class="rc-actions-row"><button class="rc-btn primary" type="button" :disabled="cfg.planned" @click="onTrial">执行试跑</button><button class="rc-btn" type="button" @click="ElMessage.info('查看日志（演示占位）')">查看日志</button></div>
        </template>
      </template>
    </div>
    </template>

    <template v-else>
      <div class="rc-insp-head">
        <div>
          <div class="rc-insp-title">未选择节点</div>
          <div class="rc-insp-sub">点击画布节点查看 / 编辑配置</div>
        </div>
      </div>
      <div class="rc-inspector-body">
        <div class="rc-help">当前画布为空或未选择节点。用顶部「＋ 新建流程」智能生成，或从左侧节点库拖入节点。</div>
      </div>
    </template>

    <TableEditDialog v-model:open="tableDlg.open" :table-id="tableDlg.tableId" @saved="onTableSaved" />
    <TableDataDialog
      v-model:open="dataDlg.open"
      :table-id="cc?.outputTable || ''"
      :source-id="flow.sourceCtx?.sourceId"
      :title="`查看全部数据 · ${selectedTable?.tableName || cc?.outputTable || ''}`"
    />
  </div>
</template>

<style scoped>
.rc-inspector { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.rc-insp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.rc-insp-title { font-weight: 700; color: var(--rc-text); font-size: 13px; }
.rc-insp-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.rc-inspector-body { padding: 12px; overflow: auto; }

.rc-inspector-tabs { display: flex; padding: 4px; border: 1px solid #eef2f7; border-radius: 8px; background: #f8fafc; margin-bottom: 12px; }
.rc-inspector-tabs button { flex: 1; border: 0; background: transparent; border-radius: 6px; padding: 6px 4px; color: var(--rc-muted); font-size: 11px; cursor: pointer; }
.rc-inspector-tabs button.active { background: #fff; color: var(--rc-primary-ink); font-weight: 700; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }

.rc-field { display: block; min-width: 0; height: auto; padding: 0; border: 0; background: transparent; white-space: normal; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.rc-input, .rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-input:focus, .rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-help-inline { margin-top: 5px; color: var(--rc-muted); font-size: 11px; line-height: 1.4; }
.rc-input.slim { height: 30px; padding: 0 9px; }
.rc-input.cron { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.rc-input-group { display: flex; align-items: stretch; width: 100%; }
.rc-input-group .rc-input { border-radius: 7px 0 0 7px; }
.rc-input-group .rc-select.grow { border-radius: 7px 0 0 7px; flex: 1; }
.rc-input-action { min-width: 36px; border: 1px solid #dbe3ee; border-left: 0; background: #fff; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.rc-input-action:last-child { border-radius: 0 7px 7px 0; }
.rc-input-action:hover { background: var(--rc-primary-bg); }
.rc-icon-btn { width: 32px; border: 1px solid #dbe3ee; border-left: 0; background: #fff; color: var(--rc-primary); cursor: pointer; font-size: 13px; }
.rc-icon-btn:last-child { border-radius: 0 7px 7px 0; }
.rc-icon-btn:hover { background: var(--rc-primary-bg); }
.rc-actions-row { display: flex; gap: 8px; margin-top: 12px; }
.rc-actions-row .rc-btn { height: 32px; padding: 0 11px; font-size: 12px; }
.ni-preview { margin-top: 12px; border: 1px solid var(--rc-border); border-radius: 8px; background: #fff; overflow: hidden; display: flex; flex-direction: column; max-height: 280px; }
.ni-preview-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; }
.ni-preview-head b { font-size: 12px; color: var(--rc-text); }
.ni-preview-tag { padding: 1px 7px; font-size: 10px; border-radius: 999px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ni-preview-more { margin-left: auto; border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; font-weight: 600; cursor: pointer; }
.ni-preview-more:hover { color: var(--rc-primary-ink); }
.ni-preview-empty { padding: 18px 12px; color: var(--rc-faint); font-size: 12px; text-align: center; line-height: 1.6; }

.rc-checks { display: flex; gap: 16px; padding: 4px 0; }
.rc-check { display: inline-flex; align-items: center; gap: 6px; color: var(--rc-text-2); font-size: 12px; cursor: pointer; }

.rc-segment { display: inline-flex; border: 1px solid #dbe3ee; border-radius: 7px; overflow: hidden; background: #fff; }
.rc-segment button { border: 0; border-left: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); padding: 7px 10px; font-size: 12px; cursor: pointer; }
.rc-segment button:first-child { border-left: 0; }
.rc-segment button.active { background: var(--rc-primary); color: #fff; font-weight: 700; }

.rc-file-upload { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; padding: 8px 9px; border: 1px dashed #cbd5e1; background: #f8fafc; border-radius: 7px; color: var(--rc-muted); font-size: 11px; }
.rc-file-upload .rc-btn { height: 28px; padding: 0 10px; font-size: 12px; }

.rc-dir-picker { border: 1px solid #dbe3ee; border-radius: 8px; overflow: hidden; background: #fff; }
.rc-dir-top { display: flex; align-items: center; gap: 6px; padding: 7px; border-bottom: 1px solid #eef2f7; background: #fbfdff; }
.rc-dir-top .rc-btn { height: 30px; padding: 0 10px; font-size: 12px; flex: none; }
.rc-dir-tree { max-height: 104px; overflow: auto; padding: 6px 8px; color: var(--rc-text-2); font-size: 11px; line-height: 1.9; }
.rc-dir-node.active { color: var(--rc-primary-ink); font-weight: 700; }

.rc-scheduler { border: 1px solid #dbe3ee; border-radius: 8px; background: #fff; overflow: hidden; }
.rc-scheduler-head { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 8px; border-bottom: 1px solid #eef2f7; background: #fbfdff; }
.rc-weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 5px; padding: 8px; }
.rc-day { display: flex; align-items: center; justify-content: center; height: 26px; border: 1px solid var(--rc-border); border-radius: 6px; color: var(--rc-muted); background: #fff; font-size: 10px; cursor: pointer; }
.rc-day.active { border-color: #93c5fd; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }
.rc-cron-preview { display: flex; align-items: center; gap: 8px; padding: 8px; border-top: 1px solid #eef2f7; background: #fff; }
.rc-cron-preview span { color: var(--rc-muted); font-size: 11px; flex: none; }

.rc-table-detail { border: 1px solid var(--rc-border); border-radius: 8px; overflow: hidden; margin-top: 4px; }
.rc-table-detail-grid { display: grid; grid-template-columns: 64px 1fr 64px 1fr; border-bottom: 1px solid #eef2f7; font-size: 11px; }
.rc-table-detail-grid b { padding: 8px; background: #fbfdff; border-right: 1px solid #eef2f7; color: var(--rc-text-2); font-weight: 600; }
.rc-table-detail-grid span { padding: 8px; border-right: 1px solid #eef2f7; color: var(--rc-text); }
.rc-table-detail-grid span:nth-child(4n) { border-right: 0; }

.rc-mini-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.rc-mini-table th { text-align: left; color: var(--rc-muted); font-weight: 600; padding: 6px 5px; border-bottom: 1px solid #eef2f7; }
.rc-mini-table td { padding: 7px 5px; border-bottom: 1px solid var(--rc-border-soft); color: var(--rc-text-2); }
.rc-edit-table th:last-child, .rc-edit-table td:last-child { width: 26px; padding: 4px 2px; }
.rc-cell-input { width: 100%; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--rc-text-2); font-size: 11px; padding: 4px 5px; outline: none; }
.rc-cell-input:hover { border-color: #dbe3ee; }
.rc-cell-input:focus { border-color: #60a5fa; background: #fff; box-shadow: 0 0 0 2px #dbeafe; }
.rc-row-del { width: 20px; height: 20px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.rc-row-del:hover { background: var(--rc-error-bg); color: #b91c1c; }

.rc-tagchips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.rc-tagchip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 7px; border-radius: 6px; border: 1px solid #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-tagchip i { cursor: pointer; font-style: normal; opacity: 0.7; }
.rc-tagchip i:hover { opacity: 1; }

.rc-cred { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border: 1px solid #dbe3ee; border-radius: 7px; background: #f8fafc; font-size: 12px; color: var(--rc-text-2); }
.rc-cred-empty { color: var(--rc-faint); }

.rc-stepper { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-bottom: 12px; }
.rc-step { min-height: 48px; border: 1px solid var(--rc-border); border-radius: 7px; background: #fff; padding: 7px 8px; color: var(--rc-muted); text-align: left; cursor: pointer; }
.rc-step:hover { border-color: #bfdbfe; background: #fbfdff; }
.rc-step.active { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); box-shadow: 0 0 0 2px #dbeafe; }
.rc-step b { display: block; font-size: 12px; color: inherit; }
.rc-step span { display: block; margin-top: 3px; font-size: 10px; color: var(--rc-faint); line-height: 1.3; }

.rc-confirm-card { border: 1px solid var(--rc-border); border-radius: 9px; overflow: hidden; background: #fff; }
.rc-confirm-title { padding: 10px 12px; border-bottom: 1px solid #eef2f7; color: var(--rc-text); font-size: 13px; font-weight: 700; background: #fbfdff; }
.rc-confirm-actions { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #eef2f7; background: #fbfdff; }
.rc-confirm-actions .rc-btn { height: 32px; padding: 0 11px; font-size: 12px; }
.rc-list { border: 1px solid #eef2f7; border-radius: 8px; overflow: hidden; }
.rc-list-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 9px; border-top: 1px solid #eef2f7; font-size: 11px; color: var(--rc-text-2); }
.rc-list-row:first-child { border-top: 0; }
.rc-list-row b { color: var(--rc-text); font-weight: 600; }

.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.rc-drawer { margin-bottom: 12px; padding: 10px; border: 1px solid #bfdbfe; background: var(--rc-primary-bg); color: #1e40af; border-radius: 8px; font-size: 11px; line-height: 1.55; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
