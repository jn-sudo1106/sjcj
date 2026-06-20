<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { sourceApi, type Source, type SourceCategory, type Step, type SourceLog, type TaskInst } from '../../api'
import { useUiStore } from '../../stores/ui'
import CategoryTree from './CategoryTree.vue'
import SourceDetailDrawer from './SourceDetailDrawer.vue'
import NewSourceWizard from './NewSourceWizard.vue'

const ui = useUiStore()

// ---- 分类 / 统计 ----
const categories = ref<SourceCategory[]>([])
const activeCat = ref('')
const stats = reactive({ total: 0, error: 0, externalChanged: 0, disabled: 0 })

// ---- 筛选 ----
const keyword = ref('')
const stateFilter = ref('all')
const cycleFilter = ref('all')
const alarmOnly = ref(false)

// ---- 列表 / 分页 / 选择 ----
const list = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const selectedIds = ref<string[]>([])

// ---- 详情抽屉 / 向导 ----
const detail = reactive<{ visible: boolean; source: Source | null; steps: Step[]; loading: boolean }>({
  visible: false,
  source: null,
  steps: [],
  loading: false,
})
const wizardVisible = ref(false)

// ---- 日志 / 任务 / 批量导入弹窗 ----
const logDlg = reactive<{ visible: boolean; rows: SourceLog[]; name: string }>({ visible: false, rows: [], name: '' })
const taskDlg = reactive<{ visible: boolean; rows: TaskInst[]; name: string }>({ visible: false, rows: [], name: '' })
const importDlg = reactive({ visible: false, template: '', deep: false, dir: '', lines: '' })

// ---- 加载 ----
async function loadList() {
  loading.value = true
  try {
    const res = await sourceApi.sourcePaged({
      category: activeCat.value,
      keyword: keyword.value,
      state: stateFilter.value,
      cycle: cycleFilter.value,
      alarm: alarmOnly.value || undefined,
      page: page.value,
      size: size.value,
    })
    list.value = res.list
    total.value = res.total
  } finally {
    loading.value = false
  }
}
async function loadCategories() {
  categories.value = await sourceApi.sourceCategories()
}
async function loadStats() {
  Object.assign(stats, await sourceApi.sourceStats())
}

function resetAndLoad() {
  page.value = 1
  selectedIds.value = []
  loadList()
}

watch([activeCat, stateFilter, cycleFilter, alarmOnly], resetAndLoad)
let kwTimer: ReturnType<typeof setTimeout> | undefined
watch(keyword, () => {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(resetAndLoad, 300)
})

function onSizeChange() {
  page.value = 1
  loadList()
}

// ---- 筛选辅助 ----
const hasFilter = computed(
  () =>
    !!activeCat.value ||
    !!keyword.value ||
    stateFilter.value !== 'all' ||
    cycleFilter.value !== 'all' ||
    alarmOnly.value,
)
function clearFilters() {
  activeCat.value = ''
  keyword.value = ''
  stateFilter.value = 'all'
  cycleFilter.value = 'all'
  alarmOnly.value = false
}

// ---- 多选 ----
const allChecked = computed(() => list.value.length > 0 && selectedIds.value.length === list.value.length)
const indeterminate = computed(() => selectedIds.value.length > 0 && !allChecked.value)
function toggleAll(v: boolean | string | number) {
  selectedIds.value = v ? list.value.map((s) => s.sourceId) : []
}
function toggleRow(id: string) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}

// ---- 展示辅助 ----
function statusMeta(s: Source) {
  if (s.disabled) return { cls: 'muted', text: '已停用' }
  if (s.state === 'C') return { cls: 'ok', text: '成功' }
  if (s.state === 'E') return { cls: 'err', text: '出错' }
  if (s.state === 'L') return { cls: 'run', text: '运行中' }
  return { cls: 'muted', text: '未知' }
}
function catLeaf(s: Source) {
  return s.categoryPath?.split('/').filter(Boolean).pop() || '—'
}

// ---- 详情 ----
async function openDetail(s: Source) {
  detail.visible = true
  detail.source = s
  detail.steps = []
  detail.loading = true
  try {
    detail.steps = await sourceApi.sourceSteps(s.sourceId)
  } finally {
    detail.loading = false
  }
}

// ---- 写类 / 高危操作：统一二次确认占位 ----
async function confirmDanger(title: string, body: string, run: () => Promise<{ message?: string }>) {
  try {
    await ElMessageBox.confirm(body, title, {
      type: 'warning',
      confirmButtonText: '确认执行',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const res = await run()
  ElMessage.success(res?.message || '操作已提交（演示）')
}

function onSnatch(s: Source) {
  confirmDanger('发起抓取', `将向「${s.name}」下发一次抓取任务，是否继续？`, () => sourceApi.sendSnatch([s.sourceId]))
}
function onCopy(s: Source) {
  confirmDanger('复制派生源', `将基于「${s.name}」复制派生一个新源，是否继续？`, () => sourceApi.copySource(s.sourceId))
}
function onToggleEnable(s: Source) {
  const verb = s.disabled ? '启用' : '停用'
  confirmDanger(`${verb}源`, `确认${verb}「${s.name}」？`, () => sourceApi.changeSourceEnable(s.sourceId, !s.disabled))
}
function onGenerateConfig(s: Source) {
  confirmDanger('生成新配置', `将为「${s.name}」生成新配置并应用，是否继续？`, () => sourceApi.generateConfig(s.sourceId))
}

// ---- 行内「查询」下拉 ----
async function onQuery(cmd: string, s: Source) {
  if (cmd === 'detail') return openDetail(s)
  if (cmd === 'log') {
    logDlg.name = s.name
    logDlg.rows = await sourceApi.sourceLogs(s.sourceId)
    logDlg.visible = true
    return
  }
  if (cmd === 'task') {
    taskDlg.name = s.name
    taskDlg.rows = await sourceApi.sourceTasks(s.sourceId)
    taskDlg.visible = true
    return
  }
  ElMessage.info(`${cmd === 'monitor' ? '监控' : cmd === 'file' ? '原始文件' : '保存时 Json'}：演示环境占位`)
}
// ---- 行内「变更」下拉 ----
function onChange(cmd: string, s: Source) {
  if (cmd === 'edit') return openDetail(s)
  if (cmd === 'copySrc') return onCopy(s)
  if (cmd === 'copyAll')
    return confirmDanger('制作源+配置副本', `复制「${s.name}」的源与配置副本？`, () => sourceApi.copySource(s.sourceId))
  if (cmd === 'genConfig') return onGenerateConfig(s)
}

// ---- 抽屉内操作 ----
function onDrawerSnatch() {
  if (detail.source) onSnatch(detail.source)
}
function onDrawerCopy() {
  if (detail.source) onCopy(detail.source)
}
function onDrawerToggle() {
  if (detail.source) onToggleEnable(detail.source)
}

// ---- 批量 ----
function requireSelection(): boolean {
  if (!selectedIds.value.length) {
    ElMessage.warning('请先在列表勾选源')
    return false
  }
  return true
}
function onBatchSnatch() {
  if (!requireSelection()) return
  confirmDanger('批量发任务', `将向选中的 ${selectedIds.value.length} 个源下发抓取任务，是否继续？`, () =>
    sourceApi.sendSnatch(selectedIds.value),
  )
}
function onBatchDelete() {
  if (!requireSelection()) return
  confirmDanger('批量删除（高危）', `将删除选中的 ${selectedIds.value.length} 个源，删除后不可恢复，是否继续？`, () =>
    sourceApi.deleteSource(selectedIds.value),
  )
}
function onOperate(cmd: string) {
  if (!requireSelection()) return
  const map: Record<string, string> = {
    success: '改为成功状态', enable: '启用', disable: '禁用', delete: '删除',
    schedule: '批量定时', modify: '批量改配置',
  }
  if (cmd === 'delete') return onBatchDelete()
  confirmDanger(`${map[cmd]}（${selectedIds.value.length} 个源）`, `确认对选中源执行「${map[cmd]}」？`, () =>
    cmd === 'modify'
      ? sourceApi.batchModifyConfig(selectedIds.value, '—')
      : cmd === 'schedule'
        ? sourceApi.batchSchedule(selectedIds.value)
        : sourceApi.changeSourceEnable(selectedIds.value[0], cmd !== 'enable'),
  )
}
function onMonitor(cmd: string) {
  if (!requireSelection()) return
  if (cmd.startsWith('freq')) {
    const tag = cmd.replace('freq-', '')
    return confirmDanger('频率标识', `将选中源频率标识设为「${tag}」？`, () => sourceApi.changeFreqTag(selectedIds.value, tag))
  }
  const verb = cmd === 'normal' ? '人工核验已正常' : '人工标为异常'
  confirmDanger(verb, `确认对选中源执行「${verb}」？`, () => sourceApi.markVerified(selectedIds.value, cmd))
}

function onBatchImport() {
  importDlg.visible = true
}
async function submitImport() {
  const res = await sourceApi.batchImport(importDlg.template, importDlg.lines)
  ElMessage.success(res?.message || '批量导入已提交（演示）')
  importDlg.visible = false
}

function openWizard() {
  wizardVisible.value = true
}
function onWizardSubmit() {
  ElMessage.success('新建源草稿已记录（演示环境，未写入后端）')
}

// ---- 顶部模块按钮接线 ----
onMounted(() => {
  loadCategories()
  loadStats()
  loadList()
  ui.registerAction('新建采集源', openWizard)
  ui.registerAction('批量导入', onBatchImport)
  ui.registerAction('批量操作', () => {
    if (requireSelection()) ElMessage.info('已选源可在列表上方批量工具条中操作')
  })
})
onUnmounted(() => ui.clearActions())
</script>

<template>
  <div class="ca-layout">
    <CategoryTree :categories="categories" v-model="activeCat" :all-count="stats.total" />

    <div class="rc-card ca-main">
      <!-- KPI -->
      <div class="rc-metric-grid ca-kpis">
        <div class="rc-metric"><span>源总数</span><b>{{ stats.total }}</b></div>
        <div class="rc-metric"><span>采集异常</span><b class="danger">{{ stats.error }}</b></div>
        <div class="rc-metric"><span>外部变更待确认</span><b>{{ stats.externalChanged }}</b></div>
        <div class="rc-metric"><span>已停用</span><b>{{ stats.disabled }}</b></div>
      </div>

      <!-- 工具条：筛选 -->
      <div class="rc-toolbar wrap">
        <el-input
          v-model="keyword"
          :prefix-icon="Search"
          clearable
          placeholder="搜索源名 / ID / URL / 责任人"
          style="width: 240px"
        />
        <el-select v-model="stateFilter" style="width: 130px">
          <el-option label="全部状态" value="all" />
          <el-option label="成功" value="C" />
          <el-option label="出错" value="E" />
          <el-option label="运行中" value="L" />
          <el-option label="已停用" value="disabled" />
        </el-select>
        <el-select v-model="cycleFilter" style="width: 120px">
          <el-option label="全部周期" value="all" />
          <el-option v-for="c in ['实时', '每日', '每周', '每月']" :key="c" :label="c" :value="c" />
        </el-select>
        <el-checkbox v-model="alarmOnly">仅看告警</el-checkbox>
        <el-button v-if="hasFilter" text @click="clearFilters">清空筛选</el-button>
        <span class="ca-spacer" />
        <span class="muted">共 {{ total }} 个源</span>
      </div>

      <!-- 批量工具条（选中时出现） -->
      <div v-if="selectedIds.length" class="ca-batchbar">
        <span>已选 <b>{{ selectedIds.length }}</b> 个源</span>
        <button class="rc-btn" type="button" @click="onBatchSnatch">发抓取</button>
        <el-dropdown trigger="click" @command="onOperate">
          <button class="rc-btn" type="button">操作类 ▾</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="success">改为成功状态</el-dropdown-item>
              <el-dropdown-item command="enable">启用</el-dropdown-item>
              <el-dropdown-item command="disable">禁用</el-dropdown-item>
              <el-dropdown-item command="schedule" divided>批量定时</el-dropdown-item>
              <el-dropdown-item command="modify">批量改配置</el-dropdown-item>
              <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click" @command="onMonitor">
          <button class="rc-btn" type="button">监控类 ▾</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="freq-日度">频率：日度</el-dropdown-item>
              <el-dropdown-item command="freq-周度">频率：周度</el-dropdown-item>
              <el-dropdown-item command="freq-月度">频率：月度</el-dropdown-item>
              <el-dropdown-item command="normal" divided>人工核验已正常</el-dropdown-item>
              <el-dropdown-item command="abnormal">人工标为异常</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button class="rc-btn danger" type="button" @click="onBatchDelete">批量删除</button>
        <el-button text @click="selectedIds = []">清空选择</el-button>
      </div>

      <!-- 表格 -->
      <div v-loading="loading" class="rc-table-scroll ca-table">
        <table class="rc-data-table">
          <thead>
            <tr>
              <th style="width: 40px">
                <el-checkbox :model-value="allChecked" :indeterminate="indeterminate" @change="toggleAll" />
              </th>
              <th>源</th>
              <th style="width: 90px">类型</th>
              <th style="width: 150px">绑定配置 · 主表</th>
              <th style="width: 64px">周期</th>
              <th style="width: 118px">同步状态</th>
              <th style="width: 88px">数据量</th>
              <th style="width: 96px">责任人</th>
              <th style="width: 196px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in list" :key="s.sourceId" :class="{ active: selectedIds.includes(s.sourceId) }">
              <td><el-checkbox :model-value="selectedIds.includes(s.sourceId)" @change="toggleRow(s.sourceId)" /></td>
              <td>
                <div class="ca-src">
                  <button class="ca-src-name" type="button" @click="openDetail(s)">{{ s.name }}</button>
                  <span v-if="s.externalChanged" class="ca-flag">外部变更</span>
                </div>
                <div class="muted">{{ s.sourceId }} · {{ s.url }}</div>
              </td>
              <td>{{ catLeaf(s) }}</td>
              <td>{{ s.configId }} · {{ s.mainTable }}</td>
              <td>{{ s.cycle || '—' }}</td>
              <td>
                <span class="rc-status" :class="statusMeta(s).cls">{{ statusMeta(s).text }}</span>
                <span v-if="s.alarm" class="rc-status warn ca-alarm">告警</span>
              </td>
              <td>{{ (s.dataCount ?? 0).toLocaleString() }}</td>
              <td>{{ s.owner }}</td>
              <td>
                <el-button link type="primary" size="small" @click="openDetail(s)">详情</el-button>
                <el-dropdown trigger="click" @command="(c: string) => onQuery(c, s)">
                  <el-button link type="primary" size="small">查询 ▾</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="monitor">监控</el-dropdown-item>
                      <el-dropdown-item command="log">日志</el-dropdown-item>
                      <el-dropdown-item command="task">任务</el-dropdown-item>
                      <el-dropdown-item command="detail">详情</el-dropdown-item>
                      <el-dropdown-item command="file">原始文件</el-dropdown-item>
                      <el-dropdown-item command="json">保存时 Json</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-dropdown trigger="click" @command="(c: string) => onChange(c, s)">
                  <el-button link type="primary" size="small">变更 ▾</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="edit">编辑</el-dropdown-item>
                      <el-dropdown-item command="copyAll">制作源+配置副本</el-dropdown-item>
                      <el-dropdown-item command="copySrc">仅制作源副本</el-dropdown-item>
                      <el-dropdown-item command="genConfig">生成新配置并应用</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- 空态 -->
        <div v-if="!loading && !list.length" class="ca-empty">
          <div class="ca-empty-title">没有匹配的源</div>
          <div class="muted">调整筛选条件，或返回全部源 / 批量导入模板源。</div>
          <div class="ca-empty-actions">
            <button class="rc-btn" type="button" @click="clearFilters">清空筛选 / 返回全部源</button>
            <button class="rc-btn primary" type="button" @click="onBatchImport">批量导入</button>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div class="ca-pager">
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
  </div>

  <SourceDetailDrawer
    v-model:visible="detail.visible"
    :source="detail.source"
    :steps="detail.steps"
    :loading="detail.loading"
    @snatch="onDrawerSnatch"
    @copy="onDrawerCopy"
    @toggle-enable="onDrawerToggle"
  />
  <NewSourceWizard v-model:visible="wizardVisible" @submit="onWizardSubmit" />

  <!-- 源日志弹窗 -->
  <el-dialog v-model="logDlg.visible" :title="`源日志 · ${logDlg.name}`" width="640px">
    <table class="rc-data-table">
      <thead>
        <tr><th>动作 ID</th><th>动作</th><th>结果</th><th>备注</th><th>时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="l in logDlg.rows" :key="l.logId">
          <td>{{ l.logId }}</td><td>{{ l.action }}</td>
          <td><span class="rc-status ok">{{ l.result }}</span></td>
          <td>{{ l.remark }}</td><td>{{ l.at }}</td>
        </tr>
      </tbody>
    </table>
  </el-dialog>

  <!-- 任务实例弹窗 -->
  <el-dialog v-model="taskDlg.visible" :title="`任务实例 · ${taskDlg.name}`" width="760px">
    <table class="rc-data-table">
      <thead>
        <tr><th>任务 ID</th><th>状态</th><th>类型</th><th>执行节点</th><th>主题</th><th>更新时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="t in taskDlg.rows" :key="t.taskId">
          <td>{{ t.taskId }}</td>
          <td><span class="rc-status" :class="statusMeta({ state: t.state } as Source).cls">{{ t.state }}</span></td>
          <td>{{ t.typeName }}</td><td>{{ t.node }}</td><td>{{ t.topic }}</td><td>{{ t.updatedAt }}</td>
          <td>
            <el-button link type="primary" size="small">详情</el-button>
            <el-button link type="danger" size="small" @click="ElMessage.info('重发：演示环境占位，高危需审批')">重发</el-button>
          </td>
        </tr>
      </tbody>
    </table>
  </el-dialog>

  <!-- 模板源批量导入弹窗 -->
  <el-dialog v-model="importDlg.visible" title="批量导入（模板源）" width="640px">
    <el-form label-width="92px" label-position="right">
      <el-form-item label="模板源">
        <el-input v-model="importDlg.template" placeholder="301287174-004432-南方中证申万有色金属ETF联接A" />
      </el-form-item>
      <el-form-item label="深度复制">
        <el-switch v-model="importDlg.deep" />
        <span class="muted ca-imp-hint">如开启，则会自动为多行数据生成多个配置</span>
      </el-form-item>
      <el-form-item label="目标目录">
        <el-input v-model="importDlg.dir" placeholder="目录 ID / 目录名" />
      </el-form-item>
      <el-form-item label="名称;URL">
        <el-input v-model="importDlg.lines" type="textarea" :rows="5" placeholder="名称与 URL 分割符；例：名称;url" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="importDlg.visible = false">取消</el-button>
      <el-button type="primary" @click="submitImport">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.ca-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 12px;
}
.ca-main {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 215px);
  min-height: 520px;
}
.ca-kpis {
  padding: 14px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
}
.ca-spacer {
  flex: 1;
}
.ca-batchbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
  background: var(--rc-primary-bg);
  font-size: 13px;
  color: var(--rc-text-2);
}
.ca-batchbar b {
  color: var(--rc-primary-ink);
}
.ca-table {
  flex: 1;
}
.ca-src {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ca-src-name {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rc-primary-ink);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.ca-src-name:hover {
  text-decoration: underline;
}
.ca-flag {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--rc-warn-bg);
  color: var(--rc-warn);
  font-size: 11px;
  font-weight: 600;
}
.ca-alarm {
  margin-left: 6px;
}
.ca-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 56px 16px;
  text-align: center;
}
.ca-empty-title {
  color: var(--rc-text);
  font-size: 14px;
  font-weight: 700;
}
.ca-empty-actions {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}
.ca-pager {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
  border-top: 1px solid var(--rc-border-soft);
}
.ca-imp-hint {
  margin-left: 10px;
  font-size: 12px;
}

@media (max-width: 1240px) {
  .ca-layout {
    grid-template-columns: 1fr;
  }
  .ca-main {
    height: auto;
  }
}
</style>
