<script setup lang="ts">
// 运行记录列表层：一行一次正式运行（不是一条表/一个方法一行）。
//
// 三维筛选（执行/数据/通知）服务端不支持，只在已加载记录上筛，UI 必须写明
// 「仅筛选已加载记录」并显示「已加载 N / 共 M」，避免让人以为筛了全量。

import { computed, reactive } from 'vue'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import { countTextOf } from './runDetail'
import {
  RUN_DATA_OPTIONS,
  RUN_EXEC_OPTIONS,
  RUN_NOTIFY_OPTIONS,
  SCOPE_NOTE,
  anyFilterActive,
  dataTextOf,
  dataTone,
  emptyRunFilters,
  execTextOf,
  execTone,
  filterRuns,
  notifyShortText,
  notifyTone,
  runCountText,
  runTimeText,
  scopeLabel,
  type RunFilters,
  type RunScope,
} from './runScope'

const props = defineProps<{
  scope: RunScope
  runs: MonitorRunView[]
  loading: boolean
  error: string
  total: number
  truncated: boolean
}>()

const emit = defineEmits<{ open: [run: MonitorRunView]; refresh: [] }>()

const filters = reactive<RunFilters>(emptyRunFilters())
const visibleRuns = computed(() => filterRuns(props.runs, filters))
const filterActive = computed(() => anyFilterActive(filters))

const countText = computed(() => {
  if (!props.total) return '共 0 条'
  return `已加载 ${props.runs.length} / 共 ${props.total} 条`
})

const emptyText = computed(() =>
  filterActive.value ? '没有符合筛选条件的运行记录' : '该范围内还没有正式运行记录',
)

/** 新执行器写结构化结论；旧日志两个字段都没有，列表回退到 run.count。 */
function hasStructuredCount(run: MonitorRunView): boolean {
  return run.checkedCount != null || run.abnormalCount != null
}

/** 异常数 > 0 用错误色，= 0（或未知）用中性色。 */
function abnormalTone(run: MonitorRunView): string {
  return run.abnormalCount != null && run.abnormalCount > 0 ? 'is-err' : 'is-muted'
}

/** 结构化条数完整文案：同时作为单元格 title，超长数字被省略号裁剪时仍可悬停查看。 */
function structuredCountText(run: MonitorRunView): string {
  return `检查 ${countTextOf(run.checkedCount)} 条 · 异常 ${countTextOf(run.abnormalCount)} 条`
}

function resetFilters() {
  Object.assign(filters, emptyRunFilters())
}
</script>

<template>
  <div class="mr-list">
    <div class="mr-scope">
      <div class="mr-scope-main">
        <span class="mr-scope-label">{{ scopeLabel(scope) }}</span>
        <span class="mr-scope-note">{{ SCOPE_NOTE }}</span>
      </div>
      <span class="mr-total" data-testid="runs-total">{{ countText }}</span>
      <button
        class="rc-btn tiny"
        type="button"
        :disabled="loading"
        data-testid="runs-refresh"
        @click="emit('refresh')"
      >{{ loading ? '加载中…' : '刷新' }}</button>
    </div>

    <div v-if="truncated" class="mr-warn" data-testid="runs-truncated">
      记录超过单次加载上限：已加载 {{ runs.length }} / 共 {{ total }} 条，列表筛选只作用于已加载部分。
      请按检查项查看，或缩小范围后再查。
    </div>

    <div class="mr-filters">
      <label class="mr-filter">
        <span>执行状态</span>
        <select v-model="filters.exec" class="mr-select" aria-label="执行状态">
          <option value="">全部</option>
          <option v-for="option in RUN_EXEC_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="mr-filter">
        <span>数据结论</span>
        <select v-model="filters.data" class="mr-select" aria-label="数据结论">
          <option value="">全部</option>
          <option v-for="option in RUN_DATA_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <label class="mr-filter">
        <span>通知</span>
        <select v-model="filters.notify" class="mr-select" aria-label="通知">
          <option value="">全部</option>
          <option v-for="option in RUN_NOTIFY_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <button v-if="filterActive" class="rc-btn tiny" type="button" @click="resetFilters">重置筛选</button>
      <span class="mr-filter-note">筛选仅作用于已加载记录</span>
    </div>

    <div v-if="error" class="mr-error" data-testid="runs-error">
      <span>{{ error }}</span>
      <button class="rc-btn tiny" type="button" @click="emit('refresh')">重试</button>
    </div>

    <table v-else class="rc-data-table mr-table">
      <thead>
        <tr>
          <th style="width: 15%">时间</th>
          <th style="width: 19%">检查项</th>
          <th style="width: 12%">执行状态</th>
          <th style="width: 12%">数据结论</th>
          <th style="width: 21%; text-align: right">条数</th>
          <th style="width: 15%">通知</th>
          <th style="width: 6%">详情</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading && !runs.length">
          <td colspan="7" class="mr-empty-cell">正在加载运行记录…</td>
        </tr>
        <tr v-else-if="!visibleRuns.length">
          <td colspan="7" class="mr-empty-cell">{{ emptyText }}</td>
        </tr>
        <template v-else>
          <tr v-for="run in visibleRuns" :key="run.id">
            <td class="mr-time" :title="run.at">{{ runTimeText(run.at) }}</td>
            <td class="mr-name" :title="run.monitorName">
              <span class="mr-name-text">{{ run.monitorName || '—' }}</span>
              <span v-if="run.legacy" class="mr-legacy" data-testid="run-legacy-tag">旧日志</span>
            </td>
            <td>
              <span class="rc-status" :class="execTone(run.exec)" data-testid="run-exec">
                {{ execTextOf(run.exec) }}
              </span>
            </td>
            <td>
              <span class="rc-status" :class="dataTone(run.data)" data-testid="run-data">
                {{ dataTextOf(run.data) }}
              </span>
            </td>
            <td
              class="mr-count"
              data-testid="run-count"
              :title="hasStructuredCount(run) ? structuredCountText(run) : runCountText(run)"
            >
              <template v-if="hasStructuredCount(run)">
                检查 {{ countTextOf(run.checkedCount) }} 条 · <span
                  class="mr-count-abnormal"
                  :class="abnormalTone(run)"
                  data-testid="run-count-abnormal"
                >异常 {{ countTextOf(run.abnormalCount) }} 条</span>
              </template>
              <template v-else>{{ runCountText(run) }}</template>
            </td>
            <td>
              <span
                class="rc-status"
                :class="notifyTone(run.notify)"
                data-testid="run-notify"
                :title="notifyShortText(run.notify)"
              >{{ notifyShortText(run.notify) }}</span>
            </td>
            <td>
              <button class="mr-link" type="button" data-testid="run-detail" @click="emit('open', run)">
                详情
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.mr-list { display: flex; flex-direction: column; gap: 10px; }

.mr-scope {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding-bottom: 10px; border-bottom: 1px solid var(--rc-border-soft);
}
.mr-scope-main { display: flex; align-items: baseline; gap: 10px; margin-right: auto; flex-wrap: wrap; }
.mr-scope-label { font-size: 13px; font-weight: 700; color: var(--rc-text); }
.mr-scope-note { font-size: 11.5px; color: var(--rc-faint); }
.mr-total { font-size: 12px; color: var(--rc-muted); font-variant-numeric: tabular-nums; }

.mr-warn {
  padding: 8px 12px; border-radius: var(--rc-radius-sm);
  background: #fffbeb; border: 1px solid #fde68a; color: #92400e; font-size: 12px; line-height: 1.6;
}

.mr-filters { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.mr-filter { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--rc-text-2); }
.mr-select {
  height: 28px; padding: 0 8px; border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius-sm); background: #fff; font-size: 12px; color: var(--rc-text); outline: none;
}
.mr-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.mr-filter-note { font-size: 11px; color: var(--rc-faint); }

.mr-error {
  display: flex; align-items: center; gap: 12px; padding: 14px;
  border: 1px solid #fecaca; background: #fef2f2; border-radius: var(--rc-radius-sm);
  color: #b91c1c; font-size: 12.5px;
}

.mr-table { margin-top: 2px; table-layout: fixed; width: 100%; }
.mr-table th, .mr-table td { overflow: hidden; text-overflow: ellipsis; }
.mr-table td { font-size: 12px; }
.mr-time { font-family: var(--rc-mono); color: var(--rc-text-2); white-space: nowrap; }
.mr-name { max-width: 320px; }
.mr-name-text { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.mr-legacy {
  display: inline-block; margin-left: 6px; padding: 0 5px; border-radius: 3px;
  background: #f3f4f6; border: 1px solid #e5e7eb; color: #6b7280;
  font-size: 10.5px; line-height: 16px; white-space: nowrap; vertical-align: middle;
}
.mr-count { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mr-count-abnormal.is-err { color: var(--rc-error); }
.mr-count-abnormal.is-muted { color: var(--rc-muted); }
.mr-empty-cell { padding: 36px 12px; text-align: center; color: var(--rc-faint); font-size: 12.5px; }
.mr-link {
  border: none; background: none; padding: 0; cursor: pointer;
  color: var(--rc-primary); font-size: 12px;
}
.mr-link:hover { text-decoration: underline; }
</style>