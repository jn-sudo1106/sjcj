<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { ruleApi, type Rule, type RuleGroup, type RuleGate, type RuleTestCase, type SharedConfig } from '../../api'
import { useUiStore } from '../../stores/ui'
import RuleGroupPanel from './RuleGroupPanel.vue'
import RuleDetailDrawer from './RuleDetailDrawer.vue'
import FunctionTester from './FunctionTester.vue'

const ui = useUiStore()

// ---- 数据 ----
const groups = ref<RuleGroup[]>([])
const activeGroup = ref('')
const stats = reactive({ groups: 0, exprs: 0, sharedConfigs: 0, passRate: '—' })
const gate = reactive({ syntaxFail: 0, referenceWarn: 0, batchTestPassRate: 0, pendingCount: 0 })
const shared = ref<SharedConfig[]>([])

const list = ref<Rule[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const keyword = ref('')
const stateFilter = ref('all')

const detail = reactive<{ visible: boolean; rule: Rule | null; testCases: RuleTestCase[]; loading: boolean }>({
  visible: false,
  rule: null,
  testCases: [],
  loading: false,
})

const testerRef = ref<{ apply: (e: string, c: unknown) => void } | null>(null)

// ---- 加载 ----
async function loadList() {
  loading.value = true
  try {
    const res = await ruleApi.rulePaged({
      groupId: activeGroup.value,
      keyword: keyword.value,
      state: stateFilter.value,
      page: page.value,
      size: size.value,
    })
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}
async function loadAside() {
  groups.value = await ruleApi.ruleGroups()
  Object.assign(stats, await ruleApi.ruleStats())
  Object.assign(gate, await ruleApi.gateSummary())
  shared.value = await ruleApi.sharedConfigs()
}

function resetAndLoad() {
  page.value = 1
  loadList()
}
watch([activeGroup, stateFilter], resetAndLoad)
let kwTimer: ReturnType<typeof setTimeout> | undefined
watch(keyword, () => {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(resetAndLoad, 300)
})
function onSizeChange() {
  page.value = 1
  loadList()
}

const hasFilter = computed(() => !!activeGroup.value || !!keyword.value || stateFilter.value !== 'all')
function clearFilters() {
  activeGroup.value = ''
  keyword.value = ''
  stateFilter.value = 'all'
}

// ---- 展示辅助 ----
function stateMeta(s: string) {
  if (s === 'published') return { cls: 'ok', text: '已发布' }
  if (s === 'draft') return { cls: 'warn', text: '草稿' }
  return { cls: 'muted', text: '已弃用' }
}
function gateOverall(g: RuleGate) {
  if (g.syntax === 'fail' || g.batchTest === 'fail') return { cls: 'err', text: '门禁未过' }
  if (g.batchTest === 'pending') return { cls: 'muted', text: '待批测' }
  if (g.reference === 'warn') return { cls: 'warn', text: '引用告警' }
  return { cls: 'ok', text: '可发布' }
}
function sharedText(r: Rule) {
  if (!r.sharedConfigs?.length) return '—'
  return r.sharedConfigs.map((id) => shared.value.find((s) => s.id === id)?.name ?? id).join('、')
}

// ---- 详情 ----
async function openDetail(r: Rule) {
  detail.visible = true
  detail.rule = r
  detail.testCases = []
  detail.loading = true
  try {
    detail.testCases = await ruleApi.testCases(r.ruleId)
  } finally {
    detail.loading = false
  }
}

// ---- 写类 / 重操作：二次确认占位 ----
async function confirmDanger(title: string, body: string, run: () => Promise<{ message?: string }>) {
  try {
    await ElMessageBox.confirm(body, title, { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' })
  } catch {
    return
  }
  const res = await run()
  ElMessage.success(res?.message || '操作已提交（演示）')
}

function publishRule(r: Rule) {
  const o = gateOverall(r.gate)
  if (o.cls !== 'ok') {
    ElMessage.warning(`门禁未通过（${o.text}），不可发布`)
    return
  }
  confirmDanger('发布规则', `确认发布「${r.name}」${r.version}？`, () => ruleApi.publishRule(r.ruleId))
}
async function runBatch(r: Rule) {
  if (r.gate.batchTest === 'pending') {
    ElMessage.info('evaluate 待接口，批测进入待接口态（演示）')
    return
  }
  const res = await ruleApi.runBatchTest(r.ruleId)
  ElMessage.success(res?.message || '已触发批量测试（演示）')
}
function testRule(r: Rule) {
  const ctx = detail.testCases[0]?.context ?? {}
  testerRef.value?.apply(r.expr, ctx)
  detail.visible = false
  ElMessage.success('已载入函数测试器，可调整 context 后求值')
}

// ---- 抽屉事件 ----
function onDrawerPublish() {
  if (detail.rule) publishRule(detail.rule)
}
function onDrawerBatch() {
  if (detail.rule) runBatch(detail.rule)
}
function onDrawerTest() {
  if (detail.rule) testRule(detail.rule)
}

// ---- 顶部动作 ----
async function onNewGroup() {
  try {
    const { value } = await ElMessageBox.prompt('输入规则组名称', '新建规则组', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPlaceholder: '如：风险词过滤',
    })
    ElMessage.success(`规则组「${value}」已记录（演示环境，未写入后端）`)
  } catch {
    /* 取消 */
  }
}
function onImport() {
  ElMessage.info('导入规则：演示环境占位，二期接入规则包导入')
}
function onGateCheck() {
  ElMessage({
    type: gate.syntaxFail ? 'warning' : 'success',
    message: `发布校验：语法 ${gate.syntaxFail ? gate.syntaxFail + ' 项未过' : '✓'} · 引用告警 ${gate.referenceWarn} · 批测通过率 ${gate.batchTestPassRate}% · 待接口 ${gate.pendingCount}`,
  })
}

onMounted(() => {
  loadAside()
  loadList()
  ui.registerAction('新建规则组', onNewGroup)
  ui.registerAction('导入规则', onImport)
  ui.registerAction('发布校验', onGateCheck)
})
onUnmounted(() => ui.clearActions())
</script>

<template>
  <div class="ra-layout">
    <RuleGroupPanel :groups="groups" v-model="activeGroup" :all-count="stats.exprs" :gate="gate" />

    <div class="rc-card ra-main">
      <div class="rc-metric-grid ra-kpis">
        <div class="rc-metric"><span>规则组</span><b>{{ stats.groups }}</b></div>
        <div class="rc-metric"><span>表达式</span><b>{{ stats.exprs }}</b></div>
        <div class="rc-metric"><span>共享配置</span><b>{{ stats.sharedConfigs }}</b></div>
        <div class="rc-metric"><span>最近批测通过率</span><b>{{ stats.passRate }}</b></div>
      </div>

      <div class="rc-toolbar wrap">
        <el-input
          v-model="keyword"
          :prefix-icon="Search"
          clearable
          placeholder="搜索规则名 / ID / 表达式"
          style="width: 240px"
        />
        <el-select v-model="stateFilter" style="width: 130px">
          <el-option label="全部状态" value="all" />
          <el-option label="已发布" value="published" />
          <el-option label="草稿" value="draft" />
          <el-option label="已弃用" value="deprecated" />
        </el-select>
        <el-button v-if="hasFilter" text @click="clearFilters">清空筛选</el-button>
        <span class="ra-spacer" />
        <span class="muted">共 {{ total }} 条规则</span>
      </div>

      <div v-loading="loading" class="rc-table-scroll ra-table">
        <table class="rc-data-table">
          <thead>
            <tr>
              <th>规则</th>
              <th style="width: 64px">阶段</th>
              <th style="width: 150px">依赖共享配置</th>
              <th style="width: 120px">版本 · 状态</th>
              <th style="width: 56px">引用</th>
              <th style="width: 96px">门禁</th>
              <th style="width: 120px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in list" :key="r.ruleId">
              <td>
                <button class="ra-name" type="button" @click="openDetail(r)">{{ r.name }}</button>
                <div class="muted ra-expr">{{ r.expr }}</div>
              </td>
              <td>{{ r.stage }}</td>
              <td>{{ sharedText(r) }}</td>
              <td>
                {{ r.version }}
                <span class="rc-status" :class="stateMeta(r.state).cls">{{ stateMeta(r.state).text }}</span>
              </td>
              <td>{{ r.refCount }}</td>
              <td><span class="rc-status" :class="gateOverall(r.gate).cls">{{ gateOverall(r.gate).text }}</span></td>
              <td>
                <el-button link type="primary" size="small" @click="openDetail(r)">详情</el-button>
                <el-button link type="primary" size="small" @click="testRule(r)">测试</el-button>
                <el-button link type="danger" size="small" @click="publishRule(r)">发布</el-button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="!loading && !list.length" class="ra-empty">
          <div class="ra-empty-title">没有匹配的规则</div>
          <div class="muted">调整筛选条件，或返回全部规则。</div>
          <button class="rc-btn" type="button" @click="clearFilters">清空筛选</button>
        </div>
      </div>

      <div class="ra-pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="size"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          small
          @current-change="loadList"
          @size-change="onSizeChange"
        />
      </div>
    </div>

    <FunctionTester ref="testerRef" />
  </div>

  <RuleDetailDrawer
    v-model:visible="detail.visible"
    :rule="detail.rule"
    :test-cases="detail.testCases"
    :shared="shared"
    :loading="detail.loading"
    @publish="onDrawerPublish"
    @run-batch="onDrawerBatch"
    @test="onDrawerTest"
  />
</template>

<style scoped>
.ra-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr) 360px;
  gap: 12px;
}
.ra-main {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 168px);
  min-height: 560px;
}
.ra-kpis {
  padding: 14px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
}
.ra-spacer {
  flex: 1;
}
.ra-table {
  flex: 1;
}
.ra-name {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rc-primary-ink);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ra-name:hover {
  text-decoration: underline;
}
.ra-expr {
  margin-top: 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ra-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 56px 16px;
  text-align: center;
}
.ra-empty-title {
  color: var(--rc-text);
  font-size: 14px;
  font-weight: 700;
}
.ra-pager {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
  border-top: 1px solid var(--rc-border-soft);
}

@media (max-width: 1240px) {
  .ra-layout {
    grid-template-columns: 1fr;
  }
  .ra-main {
    height: auto;
  }
}
</style>
