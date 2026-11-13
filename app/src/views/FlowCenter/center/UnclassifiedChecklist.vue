<script setup lang="ts">
/**
 * 未归类 / 结构待核对清单 —— 1109《流程模板与实例》交互原型 #frame5
 * （方案 R04 §5.4 定稿）：只读扫描 + 导出清单 + 单条归集，本期不做批量归集。
 *
 * 结构：顶部提示条（标题 / 扫描时间 / 搜索 / 刷新 / 导出）→ 表格 → 底部计数 + 分页。
 * 视觉：容器、表格、状态、行内操作走 app/src/design/tokens.css 的全局设计系统类
 * （rc-card / rc-card-head / rc-data-table / rc-status / rc-actions），局部样式只写 uc- 前缀。
 *
 * 口径与边界（与方案一致，别悄悄改）：
 * - 确认前不改 flowId / stepId / configId 与源绑定；本期不做批量重算 —— 提示条放在表格上方，
 *   不放分页器旁边。
 * - 建议为空（suggestedTemplateId == null）的行只允许「查看结构」，归集按钮禁用并提示「需先核对结构」，
 *   不允许自动建议、不允许写入。
 * - 单条归集必须二次确认（ElMessageBox.confirm）；成功后才调 assignUnclassified 并刷新，回执用 ElMessage。
 * - 「忽略」= setUnclassifiedStatus(id, 'skipped')，只改核对状态、不改归属与绑定。
 * - 分页是本地分页（接口只给了 keyword 一个参数）：页数按返回的 total 算，行是本页已返回的数据。
 * - 组件常驻于页面（不自己开弹窗），active 变 true 或挂载时 active 才拉取；父级用 count-change 更新角标。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  assignUnclassified,
  fetchTemplateMetas,
  fetchUnclassified,
  setUnclassifiedStatus,
} from '@/api/flowCenterCenter'
import type { TemplateMeta, UnclassifiedRow, UnclassifiedStatus } from '@/api/types/flowCenterCenter'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ 'count-change': [count: number]; 'go-flow': [id: string] }>()

/** 本地分页：mock 返回 5 行 / total 27 时页脚显示「共 27 条 · 第 1/2 页」 */
const PAGE_SIZE = 20

const STATUS_TEXT: Record<UnclassifiedStatus, string> = {
  pending: '待确认',
  confirmed: '已确认',
  skipped: '已忽略',
}
/** 状态徽标走设计系统 rc-status 的语义色（run=主色 / ok=绿 / muted=灰） */
const STATUS_CLASS: Record<UnclassifiedStatus, string> = {
  pending: 'run',
  confirmed: 'ok',
  skipped: 'muted',
}

const rows = ref<UnclassifiedRow[]>([])
const total = ref(0)
const scannedAt = ref('—')
const keyword = ref('')
const loading = ref(false)
const error = ref('')
const page = ref(1)
/** 最近一次成功加载过（区分「还没加载」与「加载完但确实没有」） */
const loaded = ref(false)

/** 当前展开的归集下拉所在行（el-dropdown 自身负责定位 / 层级 / 点外关闭） */
const menuRow = ref<UnclassifiedRow | null>(null)
const templates = ref<TemplateMeta[]>([])
const templatesLoading = ref(false)
/** 正在提交的 row id（忽略 / 归集期间禁用该行操作） */
const saving = ref<string | null>(null)

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const pagedRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
const emptyText = computed(() =>
  rows.value.length === 0 ? '当前筛选没有待核对的条目' : '本页暂无数据 · 本地分页只展示接口已返回的行',
)

function fmt(v: number | undefined): string {
  return String(v ?? 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : '未知错误'
}

async function load(options: { keepPage?: boolean } = {}): Promise<void> {
  loading.value = true
  error.value = ''
  menuRow.value = null
  try {
    const kw = keyword.value.trim()
    const result = await fetchUnclassified(kw ? { keyword: kw } : {})
    rows.value = result.list
    total.value = result.total
    scannedAt.value = result.scannedAt
    loaded.value = true
    if (!options.keepPage) page.value = 1
    page.value = Math.min(page.value, pageCount.value)
    // 父级左侧 rail 的「未归类 / 结构待核对」角标 = 服务端未归类条数
    emit('count-change', result.total)
  } catch (e) {
    error.value = errorText(e)
    ElMessage.error(`未归类清单加载失败：${error.value}`)
  } finally {
    loading.value = false
  }
}

function refresh(): void {
  void load()
}

function goStructure(row: UnclassifiedRow): void {
  emit('go-flow', row.id)
}

function menuOptions(row: UnclassifiedRow | null): { id: string; name: string }[] {
  if (!row) return []
  const options = templates.value.map((t) => ({ id: t.id, name: t.name }))
  if (row.suggestedTemplateId && !options.some((o) => o.id === row.suggestedTemplateId)) {
    options.unshift({ id: row.suggestedTemplateId, name: row.suggestedTemplateName })
  }
  return options
}

async function ensureTemplates(): Promise<void> {
  if (templates.value.length > 0 || templatesLoading.value) return
  templatesLoading.value = true
  try {
    const list = await fetchTemplateMetas()
    templates.value = list.filter((t) => !t.disabled)
  } catch (e) {
    ElMessage.error(`模板列表加载失败：${errorText(e)}`)
  } finally {
    templatesLoading.value = false
  }
}

/** 打开某行的归集下拉：浮层定位 / 层级交给 el-dropdown，菜单内容跟着 menuRow 走 */
function openAssign(row: UnclassifiedRow): void {
  if (!row.suggestedTemplateId) {
    ElMessage.warning('需先核对结构，暂不能归集')
    return
  }
  if (saving.value === row.id) return
  menuRow.value = row
  void ensureTemplates()
}

/** 浮层收起（选中 / 点外 / Esc）时同步清掉菜单内容；触发器再点一次由 el-dropdown 自己收起 */
function onMenuVisible(row: UnclassifiedRow, visible: boolean): void {
  if (!visible && menuRow.value?.id === row.id) menuRow.value = null
}

function closeMenu(row: UnclassifiedRow): void {
  if (menuRow.value?.id === row.id) menuRow.value = null
}

/** 单条归集：二次确认 → 写归属 → 刷新（刷新里 emit count-change） */
async function chooseTemplate(row: UnclassifiedRow | null, option: { id: string; name: string }): Promise<void> {
  if (!row) return
  try {
    await ElMessageBox.confirm(
      `确认把「${row.name}」归集到模板「${option.name}」？确认前不改 flowId / stepId / configId 与源绑定。`,
      '归集确认',
      { type: 'warning', confirmButtonText: '确认归集', cancelButtonText: '取消' },
    )
  } catch {
    return // 用户取消，不算错误
  }
  saving.value = row.id
  try {
    await assignUnclassified(row.id, option.id)
    ElMessage.success(`已把「${row.name}」归集到「${option.name}」`)
    menuRow.value = null
    await load({ keepPage: true })
  } catch (e) {
    ElMessage.error(`归集失败：${errorText(e)}`)
  } finally {
    saving.value = null
  }
}

async function ignoreRow(row: UnclassifiedRow): Promise<void> {
  saving.value = row.id
  try {
    await setUnclassifiedStatus(row.id, 'skipped')
    row.status = 'skipped'
    ElMessage.success('已忽略该条（不改归属、不改源绑定）')
  } catch (e) {
    ElMessage.error(`忽略失败：${errorText(e)}`)
  } finally {
    saving.value = null
  }
}

function csvCell(value: string): string {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 导出清单：前端生成 CSV（列与 frame5 表格一致），走 Blob 下载 */
function exportCsv(): void {
  try {
    const head = ['旧归集模板', '实例', '节点类型及边', '建议模板', '原因']
    const lines = [head.map(csvCell).join(',')]
    for (const row of rows.value) {
      lines.push(
        [
          row.oldTemplate,
          `${row.name}（#${row.id}）`,
          row.chain,
          row.suggestedTemplateId ? row.suggestedTemplateName : '无匹配模板',
          row.reason,
        ]
          .map(csvCell)
          .join(','),
      )
    }
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `未归类核对清单-${stamp()}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    ElMessage.success(`已导出 ${rows.value.length} 条核对清单`)
  } catch (e) {
    ElMessage.error(`导出失败：${errorText(e)}`)
  }
}

// active 变 true（或挂载时 active）立刻拉取；变成 false 不清数据，只停手
watch(
  () => props.active,
  (active) => {
    if (active) void load()
  },
  { immediate: true },
)
</script>

<template>
  <section class="rc-card uc-root" data-testid="unclassified-checklist">
    <!-- 顶部提示条：标题 + 口径摘要 + 扫描时间 + 搜索 / 刷新 / 导出 -->
    <div class="rc-card-head uc-head">
      <div class="uc-head-main">
        <div class="uc-title-row">
          <b class="uc-title">核对清单</b>
          <span class="rc-status warn uc-count">{{ fmt(total) }} 条待核对</span>
        </div>
        <p class="uc-sub">
          <span data-testid="uc-scanned">扫描时间 {{ scannedAt }}</span>
          <span class="uc-dot">·</span>
          <span>未归类 / 结构待核对 · 只读扫描 · 单条归集（二次确认）</span>
        </p>
      </div>
      <div class="uc-tools">
        <el-input
          v-model="keyword"
          class="uc-kw"
          clearable
          placeholder="搜索实例 / 旧模板"
          data-testid="uc-keyword"
          @clear="refresh"
          @keyup.enter="refresh"
        />
        <el-button :loading="loading" data-testid="uc-refresh" @click="refresh">刷新</el-button>
        <el-button data-testid="uc-export" @click="exportCsv">导出清单</el-button>
      </div>
    </div>

    <!-- 技术口径单独一条提示放在表格上方（不塞到分页器旁边） -->
    <div class="uc-tip" data-testid="uc-tech-note">
      确认前不改 flowId / stepId / configId 与源绑定；本期只做只读扫描、导出与单条归集，不做批量重算。
    </div>

    <div class="rc-table-scroll uc-scroll">
      <div v-if="loading" class="uc-state" data-testid="uc-loading">加载中…</div>
      <div v-else-if="error" class="uc-state uc-state-err">
        <span data-testid="uc-error">{{ error }}</span>
        <el-button size="small" data-testid="uc-retry" @click="refresh">重试</el-button>
      </div>
      <table v-else class="rc-data-table uc-table" data-testid="uc-table">
        <colgroup>
          <col style="width: 110px" />
          <col style="width: 150px" />
          <col style="width: 190px" />
          <col style="width: 140px" />
          <col />
          <col style="width: 196px" />
        </colgroup>
        <thead>
          <tr>
            <th>旧归集模板</th>
            <th>实例</th>
            <th>节点类型及边</th>
            <th>建议模板</th>
            <th>原因 / 状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="pagedRows.length === 0">
            <td colspan="6" class="uc-empty" data-testid="uc-empty">
              {{ loaded ? emptyText : '尚未加载' }}
            </td>
          </tr>
          <tr v-for="row in pagedRows" :key="row.id" data-testid="uc-row">
            <td class="uc-old">{{ row.oldTemplate }}</td>
            <td>
              <div class="uc-inst" :title="row.name">{{ row.name }}</div>
              <div class="uc-mono">#{{ row.id }}</div>
            </td>
            <td>
              <div class="uc-mono uc-chain" :title="row.chain">{{ row.chain }}</div>
            </td>
            <td>
              <span v-if="row.suggestedTemplateId" class="uc-suggest">{{ row.suggestedTemplateName }}</span>
              <span v-else class="uc-none">无匹配模板</span>
            </td>
            <td class="uc-why-cell">
              <el-tooltip :content="row.reason" placement="top" :show-after="200">
                <div class="uc-why">{{ row.reason }}</div>
              </el-tooltip>
              <span class="rc-status uc-status" :class="STATUS_CLASS[row.status]" data-testid="uc-status">{{ STATUS_TEXT[row.status] }}</span>
            </td>
            <td>
              <div class="rc-actions uc-actions">
                <el-dropdown
                  trigger="click"
                  :teleported="true"
                  :disabled="!row.suggestedTemplateId || saving === row.id"
                  @visible-change="(visible: boolean) => onMenuVisible(row, visible)"
                >
                  <el-button
                    link
                    type="primary"
                    size="small"
                    data-testid="uc-assign"
                    :disabled="!row.suggestedTemplateId || saving === row.id"
                    :title="row.suggestedTemplateId ? '选择目标模板后归集' : '需先核对结构'"
                    @click="openAssign(row)"
                  >
                    归集…
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu v-if="menuRow?.id === row.id" data-testid="uc-menu">
                      <li class="uc-menu-h" role="presentation">归集到模板</li>
                      <li v-if="templatesLoading" class="uc-menu-tip" role="presentation">模板加载中…</li>
                      <el-dropdown-item
                        v-for="option in menuOptions(menuRow)"
                        :key="option.id"
                        :data-testid="`uc-assign-option-${option.id}`"
                        @click="chooseTemplate(row, option)"
                      >
                        {{ option.name }}
                      </el-dropdown-item>
                      <li v-if="!templatesLoading && menuOptions(menuRow).length === 0" class="uc-menu-tip" role="presentation">
                        没有可用模板
                      </li>
                      <el-dropdown-item divided data-testid="uc-menu-cancel" @click="closeMenu(row)">取消</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
                <el-button link size="small" data-testid="uc-structure" @click="goStructure(row)">查看结构</el-button>
                <el-button
                  link
                  size="small"
                  data-testid="uc-ignore"
                  :disabled="saving === row.id || row.status === 'skipped'"
                  @click="ignoreRow(row)"
                >
                  忽略
                </el-button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 底部计数 + 分页 -->
    <div class="uc-foot">
      <span class="uc-foot-text" data-testid="uc-page-info">共 {{ fmt(total) }} 条 · 第 {{ page }}/{{ pageCount }} 页</span>
      <span class="uc-foot-spacer" />
      <span class="uc-foot-hint">只读扫描 · 单条归集（二次确认）</span>
      <el-pagination
        v-model:current-page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        layout="prev, pager, next"
        background
        size="small"
        data-testid="uc-pager"
      />
    </div>
  </section>
</template>

<style scoped>
/* 只作用于本组件；容器 / 表格 / 状态 / 行内操作沿用全局设计系统类 */
.uc-root {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

/* ---------- 顶部提示条 ---------- */
.uc-head {
  flex: none;
  flex-wrap: wrap;
  align-items: flex-start;
}
.uc-head-main {
  min-width: 0;
}
.uc-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
}
.uc-title {
  color: var(--rc-text);
  font-size: 13px;
  font-weight: 700;
}
.uc-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 3px 0 0;
  color: var(--rc-muted);
  font-size: 12px;
  line-height: 1.45;
}
.uc-dot {
  color: var(--rc-faint);
}
.uc-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.uc-kw {
  width: 220px;
}
.uc-tools :deep(.el-button + .el-button) {
  margin-left: 0;
}
.uc-tip {
  flex: none;
  padding: 7px 16px;
  border-bottom: 1px solid var(--rc-border-soft);
  background: var(--rc-primary-bg);
  color: var(--rc-text-2);
  font-size: 12px;
  line-height: 1.5;
}

/* ---------- 表格 ---------- */
.uc-scroll {
  flex: 1;
  min-height: 0;
}
.uc-table {
  min-width: 1000px;
  table-layout: fixed;
}
.uc-table th {
  height: 38px;
}
.uc-table td {
  height: auto;
  padding: 8px 12px;
  white-space: normal;
}
.uc-old {
  color: var(--rc-text-2);
  word-break: break-all;
}
.uc-inst {
  overflow: hidden;
  color: var(--rc-text);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.uc-mono {
  color: var(--rc-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.uc-chain {
  white-space: normal;
  line-height: 1.5;
  word-break: break-all;
}
.uc-suggest {
  color: var(--rc-primary-ink);
  font-weight: 600;
}
.uc-none {
  color: var(--rc-faint);
}
.uc-why-cell {
  min-width: 220px;
}
.uc-why {
  /* 原因可能很长（如「多一条失败回退分支，待确认是否升级模板」），
     限两行 + 省略号保证行高一致；完整文案通过 el-tooltip 悬停查看。 */
  display: -webkit-box;
  overflow: hidden;
  margin: 0 0 4px;
  color: var(--rc-text-2);
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.uc-status {
  flex: none;
}
.uc-actions {
  flex-wrap: nowrap;
  gap: 6px;
}
.uc-actions :deep(.el-button) {
  margin-left: 0;
}
.uc-actions :deep(.el-button.is-link) {
  font-size: 12px;
}
.uc-state {
  padding: 40px 16px;
  color: var(--rc-muted);
  font-size: 12px;
  text-align: center;
}
.uc-state-err {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--rc-error);
}
.uc-table td.uc-empty {
  padding: 40px 16px;
  color: var(--rc-muted);
  font-size: 12px;
  text-align: center;
}

/* ---------- 归集下拉（el-dropdown 的浮层已 teleport 到 body，不被表格滚动区裁掉） ---------- */
.uc-menu-h {
  padding: 2px 12px 4px;
  color: var(--rc-faint);
  font-size: 12px;
  font-weight: 700;
  list-style: none;
}
.uc-menu-tip {
  padding: 6px 12px;
  color: var(--rc-muted);
  font-size: 12px;
  list-style: none;
}

/* ---------- 底部计数 + 分页 ---------- */
.uc-foot {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--rc-border-soft);
  background: var(--rc-surface);
}
.uc-foot-text {
  color: var(--rc-text-2);
  font-size: 12px;
  white-space: nowrap;
}
.uc-foot-spacer {
  flex: 1;
}
.uc-foot-hint {
  color: var(--rc-muted);
  font-size: 12px;
  white-space: nowrap;
}
</style>