<script setup lang="ts">
// 监控视图（0910 从旧平台「数据源告警」MonitorList 迁入，第一期只读 + 开关）。
//
// **只支持选中具体源**：后端 source/check/paged 的 sourceId 是单值，一次查不出一个网站
// 底下几千个源。前端逐源归并的路子在数据视图已经踩过——几百个串行请求、20 秒超时告警、
// 总数还算不准，不在这里重演。全部源态直接提示先选一个源；等后端加上 siteId，
// 0914 调整：进入监控视图默认选中当前网站第一个源，按 sourceId 拉 source/check/paged；
// 若网站没有源，仍保留空态提示。
//
// 第一期不做：加监控 / 编辑 / 删除 / 批量操作。那批的表单有 15+ 字段，含条件 SQL 与
// 校验规则脚本，跟"看告警"不是一个粒度，单独一期做。
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceCheckApi, type SourceCheck } from '@/api'
import { confirmDanger } from '@/utils/confirmDanger'
import SiteSourceSelect from './components/SiteSourceSelect.vue'
import CheckLogDialog from './CheckLogDialog.vue'

const props = defineProps<{ siteId: string }>()

const selectedSourceId = ref('')
const filters = reactive({ enable: '', state: '', name: '' })
const rows = ref<SourceCheck[]>([])
const total = ref(0)
const page = ref(1)
const PAGE_SIZE = 10
const loading = ref(false)
const error = ref('')
const switching = ref('')

/** 告警条数。只统计当前页——后端不给分状态的总数，跨页数字会是假的。 */
const alarmCount = computed(() => rows.value.filter((r) => r.state === 'E').length)
const onlyAlarm = computed(() => filters.state === 'E')

async function load() {
  if (!selectedSourceId.value) {
    rows.value = []
    total.value = 0
    return
  }
  loading.value = true
  error.value = ''
  try {
    const result = await sourceCheckApi.paged({
      sourceId: selectedSourceId.value,
      enable: filters.enable,
      state: filters.state,
      name: filters.name.trim(),
      page: page.value,
      size: PAGE_SIZE,
    })
    rows.value = result.list
    total.value = result.total
  } catch (e) {
    error.value = e instanceof Error ? e.message : '监控列表加载失败'
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function runQuery() {
  page.value = 1
  void load()
}
function clearFilters() {
  filters.enable = ''
  filters.state = ''
  filters.name = ''
  runQuery()
}
/** 「只看告警」＝ state=E 的一键开关，再点一次回到全部 */
function toggleOnlyAlarm() {
  filters.state = onlyAlarm.value ? '' : 'E'
  runQuery()
}

watch(selectedSourceId, () => {
  page.value = 1
  void load()
})
watch(() => props.siteId, () => {
  selectedSourceId.value = ''
})

// isDelete 的语义是反的：**0 才是在用**（旧平台在 loadData 里转了一道 enabled = isDelete === 0）。
// 这里同样只在展示层转，发回后端时仍用 0/1 的原口径，避免两边对不上。
const isOn = (row: SourceCheck) => Number(row.isDelete) === 0
async function toggleEnable(row: SourceCheck) {
  const next = isOn(row) ? 1 : 0
  switching.value = row.id
  try {
    const ack = await sourceCheckApi.changeEnable([row.id], next)
    if (ack.ok === false) throw new Error(ack.message || '操作失败')
    row.isDelete = next
    ElMessage.success(next === 0 ? '已启用' : '已停用')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '启停失败')
  } finally {
    switching.value = ''
  }
}

function runNow(row: SourceCheck) {
  void confirmDanger(
    '立即校验一次',
    `将立即执行「${row.name}」的校验，结果会写进历史日志。`,
    () => sourceCheckApi.runNow([row.id]),
    () => {
      ElMessage.success('已触发，稍后刷新查看结果')
    },
  )
}

// 执行结果形如 `2026-09-09 11:00:46---[X]:今日酒价...异常, 数量:0`。
// 前缀那段时间戳与「上次」列重复，剥掉只留真正的结果文本，把宽度让给有用的部分。
function resultText(msg: string): string {
  return (msg || '').replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\s*-+\s*/, '')
}

const logDialog = reactive({ visible: false, row: null as SourceCheck | null })
function openLogs(row: SourceCheck) {
  logDialog.row = row
  logDialog.visible = true
}
</script>

<template>
  <main class="smv-shell">
    <div class="smv-toolbar">
      <SiteSourceSelect v-model="selectedSourceId" :site-id="siteId" default-first />
      <template v-if="selectedSourceId">
        <select v-model="filters.enable" class="smv-input" aria-label="在用">
          <option value="">在用（全部）</option>
          <option value="0">在用</option>
          <option value="1">停用</option>
        </select>
        <select v-model="filters.state" class="smv-input" aria-label="告警状态">
          <option value="">状态（全部）</option>
          <option value="E">告警</option>
          <option value="C">正常</option>
        </select>
        <input v-model="filters.name" class="smv-input" placeholder="名称" aria-label="名称" />
        <button class="rc-btn primary" type="button" :disabled="loading" @click="runQuery">{{ loading ? '查询中…' : '查询' }}</button>
        <button class="rc-btn" type="button" @click="clearFilters">清空</button>
      </template>
    </div>

    <!-- 全部源态：接口的 sourceId 是单值，查不出整站。与其逐源归并（数据视图已证明会炸），
         不如把话说清楚，让用户先选一个源。 -->
    <div v-if="!selectedSourceId" class="smv-empty" data-testid="site-monitor-need-source">
      监控按源配置，请先在上方选择一个具体源
    </div>
    <div v-else-if="error" class="smv-empty">{{ error }}</div>
    <template v-else>
      <div class="smv-summary">
        <span class="smv-count">共 {{ total.toLocaleString() }} 条监控</span>
        <span v-if="alarmCount" class="rc-status err" data-testid="site-monitor-alarm-count">本页 {{ alarmCount }} 条告警</span>
        <button
          type="button"
          class="rc-btn tiny"
          :class="{ on: onlyAlarm }"
          data-testid="site-monitor-only-alarm"
          @click="toggleOnlyAlarm"
        >{{ onlyAlarm ? '看全部' : '只看告警' }}</button>
      </div>

      <div class="smv-table-wrap">
        <table class="rc-data-table smv-table" v-loading="loading">
          <thead>
            <tr>
              <th style="width:56px">在用</th>
              <th style="width:72px">状态</th>
              <th style="width:180px">名称</th>
              <th style="min-width:280px">执行结果</th>
              <th style="width:160px">表</th>
              <th style="width:120px">上次</th>
              <th style="width:130px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id" :class="{ 'is-alarm': row.state === 'E' }">
              <td @click.stop>
                <el-switch
                  :model-value="isOn(row)"
                  size="small"
                  :loading="switching === row.id"
                  :disabled="!!switching"
                  @change="toggleEnable(row)"
                />
              </td>
              <td>
                <span class="rc-status" :class="row.state === 'E' ? 'err' : 'ok'">{{ row.state === 'E' ? '告警' : '正常' }}</span>
              </td>
              <td :title="row.name">{{ row.name }}</td>
              <td class="smv-msg" :class="{ alarm: row.state === 'E' }" :title="row.lastMsg">{{ resultText(row.lastMsg) || '—' }}</td>
              <td :title="row.tableName">{{ row.tableName || '—' }}</td>
              <td :title="`cron ${row.schedule || '—'}｜下次 ${row.nextRun || '—'}`">{{ row.lastRun || '—' }}</td>
              <td class="smv-ops">
                <button type="button" class="smv-link" data-testid="site-monitor-logs" @click="openLogs(row)">日志</button>
                <button type="button" class="smv-link" data-testid="site-monitor-run" @click="runNow(row)">立即运行</button>
              </td>
            </tr>
            <tr v-if="!rows.length && !loading">
              <td colspan="7" class="smv-empty-cell">该源还没有配置监控</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="smv-pager">
        <el-pagination
          v-model:current-page="page"
          :page-size="PAGE_SIZE"
          :total="total"
          layout="total, prev, pager, next, jumper"
          background
          small
          :disabled="loading"
          @current-change="load"
        />
      </div>
    </template>

    <CheckLogDialog v-model="logDialog.visible" :check="logDialog.row" />
  </main>
</template>

<style scoped>
.smv-shell { display: flex; flex-direction: column; min-height: 0; flex: 1; background: #fff; }
.smv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.smv-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); font-size: 12px; outline: none; min-width: 110px; background: #fff; }
.smv-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.smv-toolbar .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }

/* 汇总条：先给结论（有没有告警），再让人往下看表格 */
.smv-summary { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #f8fafc; font-size: 12px; }
.smv-count { color: var(--rc-text-2); font-weight: 700; }
.smv-summary .rc-btn.tiny { height: 24px; padding: 0 10px; font-size: 11.5px; margin-left: auto; }
.smv-summary .rc-btn.tiny.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); }

.smv-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.smv-table td { font-size: 12px; }
/* 告警行整行可辨认：旧平台只在状态列放一个红 tag，得扫一整列才看得出哪条在告警 */
.smv-table tbody tr.is-alarm td:first-child { box-shadow: inset 3px 0 0 #dc2626; }
.smv-msg { max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-text-2); }
.smv-msg.alarm { color: #b91c1c; }
/* 操作列钉在右边：表格在常见宽度下就会横向滚动（实测 944 > 840），而「日志」
   「立即运行」是这页仅有的两个动作，滚出视野等于没有。rc-data-table 的 th 本身不 sticky，
   这里不会跟固定表头打架。 */
.smv-table th:last-child,
.smv-table td:last-child { position: sticky; right: 0; background: #fff; box-shadow: -8px 0 8px -8px rgba(15, 23, 42, 0.18); }
.smv-table thead th:last-child { background: #f8fafc; }
.smv-ops { white-space: nowrap; }
.smv-link { border: 0; background: none; padding: 0 6px 0 0; color: var(--rc-primary); font-size: 12px; cursor: pointer; }
.smv-link:hover { text-decoration: underline; }
.smv-empty { padding: 40px 24px; text-align: center; color: var(--rc-faint); font-size: 13px; }
.smv-empty-cell { padding: 32px; text-align: center; color: var(--rc-faint); font-size: 12px; }
.smv-pager { display: flex; justify-content: flex-end; padding: 10px 12px; border-top: 1px solid var(--rc-border-soft); }
</style>
