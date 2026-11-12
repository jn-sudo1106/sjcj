<script setup lang="ts">
// 单次运行详情层：只读本次运行冻结下来的视图（MonitorRunView），不回查当前监控定义。
//
// 六段：结论与实际数值 / 数据范围 / 逐方法逐表异常 / 冻结配置快照 / 日志 / 通知投递。
// 缺失一律「未记录」；旧日志整体降级并明确标注。

import { computed } from 'vue'
import type { MonitorRunView } from '@/api/types/monitorCenter'
import {
  DELIVERY_NOTE,
  LEGACY_NOTE,
  MISSING_TEXT,
  checkRows,
  checksEmptyText,
  deliveryEmptyText,
  deliveryRows,
  logRefOf,
  logSourceText,
  logTextOf,
  snapshotFields,
  snapshotMethodLabels,
  snapshotScript,
  summaryFields,
  windowFields,
} from './runDetail'
import { dataTextOf, dataTone, execTextOf, execTone, notifyTextOf, notifyTone, runTimeText } from './runScope'

const props = defineProps<{ run: MonitorRunView }>()
const emit = defineEmits<{ back: [] }>()

const summary = computed(() => summaryFields(props.run))
const range = computed(() => windowFields(props.run))
const checks = computed(() => checkRows(props.run))
const checksEmpty = computed(() => checksEmptyText(props.run))
const methods = computed(() => snapshotMethodLabels(props.run.config))
const snapshot = computed(() => snapshotFields(props.run.config))
const script = computed(() => snapshotScript(props.run.config))
const deliveries = computed(() => deliveryRows(props.run.deliveries))
const deliveryEmpty = computed(() => deliveryEmptyText(props.run))
const logText = computed(() => logTextOf(props.run))
const logSource = computed(() => logSourceText(props.run))
const logRef = computed(() => logRefOf(props.run))
</script>

<template>
  <div class="mr-detail">
    <div class="mr-detail-head">
      <button class="rc-btn tiny" type="button" data-testid="run-detail-back" @click="emit('back')">
        ← 返回运行列表
      </button>
      <span class="mr-detail-title" :title="run.monitorName">
        运行详情 · {{ runTimeText(run.at) }}<template v-if="run.monitorName"> · {{ run.monitorName }}</template>
      </span>
      <span v-if="run.legacy" class="mr-legacy" data-testid="run-detail-legacy">旧日志</span>
    </div>

    <div v-if="run.legacy" class="mr-warn" data-testid="run-legacy-note">
      {{ LEGACY_NOTE }}：本次运行只有旧日志文本，没有逐项结果与冻结快照；下方「未记录」的地方不用当前监控定义补齐。
    </div>

    <section class="mr-section" data-testid="run-detail-conclusion">
      <h3 class="mr-h3">结论与实际数值</h3>
      <div class="mr-badges">
        <span class="rc-status" :class="execTone(run.exec)" data-testid="detail-exec">{{ execTextOf(run.exec) }}</span>
        <span class="rc-status" :class="dataTone(run.data)" data-testid="detail-data">{{ dataTextOf(run.data) }}</span>
        <span class="rc-status" :class="notifyTone(run.notify)" data-testid="detail-notify">{{ notifyTextOf(run.notify) }}</span>
      </div>
      <dl class="mr-fields">
        <div v-for="item in summary" :key="item.label" class="mr-field" :class="{ 'is-wide': item.wide }">
          <dt>{{ item.label }}</dt>
          <dd :class="{ 'is-mono': item.mono, 'is-missing': item.missing }" :title="item.value">{{ item.value }}</dd>
        </div>
      </dl>
    </section>

    <section class="mr-section" data-testid="run-detail-range">
      <h3 class="mr-h3">数据范围</h3>
      <dl class="mr-fields">
        <div v-for="item in range" :key="item.label" class="mr-field">
          <dt>{{ item.label }}</dt>
          <dd :class="{ 'is-mono': item.mono, 'is-missing': item.missing }" :title="item.value">{{ item.value }}</dd>
        </div>
      </dl>
    </section>

    <section class="mr-section" data-testid="run-detail-checks">
      <h3 class="mr-h3">逐方法逐表异常</h3>
      <div v-if="checks.length" class="mr-table-wrap">
        <table class="rc-data-table mr-checks">
          <thead>
            <tr>
              <th style="min-width: 130px">方法</th>
              <th style="min-width: 140px">表</th>
              <th style="min-width: 96px">字段</th>
              <th style="width: 100px">执行状态</th>
              <th style="width: 100px">数据结论</th>
              <th style="width: 84px; text-align: right">检查条数</th>
              <th style="width: 84px; text-align: right">异常条数</th>
              <th style="min-width: 180px">异常样例</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in checks" :key="row.key">
              <td :title="row.method">{{ row.method }}</td>
              <td :title="row.table">{{ row.table }}</td>
              <td :title="row.field">{{ row.field }}</td>
              <td><span class="rc-status" :class="row.execTone">{{ row.exec }}</span></td>
              <td><span class="rc-status" :class="row.dataTone">{{ row.data }}</span></td>
              <td class="mr-num">{{ row.checked }}</td>
              <td class="mr-num">{{ row.abnormal }}</td>
              <td class="mr-samples" :title="row.samples">{{ row.samples }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="mr-empty" data-testid="run-checks-empty">{{ checksEmpty }}</div>
      <p v-if="!checks.length && methods.length" class="mr-hint">
        冻结快照中选中的方法：{{ methods.join('、') }}（结果未记录，不代表没有执行）
      </p>
    </section>

    <section class="mr-section" data-testid="run-detail-snapshot">
      <h3 class="mr-h3">冻结配置快照</h3>
      <p class="mr-hint">只读本次运行冻结的配置；缺失显示「{{ MISSING_TEXT }}」，不回退当前监控定义。</p>
      <dl v-if="snapshot.length" class="mr-fields">
        <div v-for="item in snapshot" :key="item.label" class="mr-field" :class="{ 'is-wide': item.wide }">
          <dt>{{ item.label }}</dt>
          <dd :class="{ 'is-mono': item.mono, 'is-missing': item.missing }" :title="item.value">{{ item.value }}</dd>
        </div>
      </dl>
      <div v-else class="mr-empty" data-testid="run-snapshot-missing">
        {{ MISSING_TEXT }}：本次运行没有冻结配置快照。
      </div>
      <template v-if="script">
        <div class="mr-sub">脚本（快照）</div>
        <pre class="mr-code mr-log" data-testid="run-snapshot-script">{{ script }}</pre>
      </template>
    </section>

    <section class="mr-section" data-testid="run-detail-log">
      <h3 class="mr-h3">
        日志
        <span v-if="logSource" class="mr-hint">{{ logSource }}</span>
      </h3>
      <pre v-if="logText" class="mr-code mr-log" data-testid="run-log-text">{{ logText }}</pre>
      <div v-else class="mr-empty" data-testid="run-log-missing">
        未取得日志内容<template v-if="logRef">；服务端日志引用：<code class="mr-code-inline">{{ logRef }}</code></template>
      </div>
    </section>

    <section class="mr-section" data-testid="run-detail-deliveries">
      <h3 class="mr-h3">通知投递</h3>
      <p class="mr-hint">{{ DELIVERY_NOTE }}</p>
      <div v-if="deliveries.length" class="mr-table-wrap">
        <table class="rc-data-table mr-deliveries">
          <thead>
            <tr>
              <th style="width: 104px">渠道</th>
              <th style="min-width: 140px">目标</th>
              <th style="width: 88px">尝试</th>
              <th style="width: 148px">状态</th>
              <th style="width: 150px">时间</th>
              <th style="min-width: 180px">说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in deliveries" :key="row.key">
              <td>{{ row.channel }}</td>
              <td :title="row.target">{{ row.target }}</td>
              <td>{{ row.attempt }}</td>
              <td><span class="rc-status" :class="row.tone" data-testid="delivery-status">{{ row.status }}</span></td>
              <td class="is-mono">{{ row.at }}</td>
              <td :title="row.message">{{ row.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="mr-empty" data-testid="run-delivery-empty">{{ deliveryEmpty }}</div>
    </section>
  </div>
</template>

<style scoped>
.mr-detail { display: flex; flex-direction: column; gap: 16px; }

.mr-detail-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding-bottom: 10px; border-bottom: 1px solid var(--rc-border-soft);
}
.mr-detail-title { font-size: 13px; font-weight: 700; color: var(--rc-text); }

.mr-warn {
  padding: 8px 12px; border-radius: var(--rc-radius-sm);
  background: #fffbeb; border: 1px solid #fde68a; color: #92400e; font-size: 12px; line-height: 1.6;
}

.mr-section {
  border: 1px solid var(--rc-border-soft); border-radius: var(--rc-radius-sm);
  padding: 12px 14px 14px; background: #fff;
}
.mr-h3 { margin: 0 0 10px; font-size: 12.5px; font-weight: 700; color: var(--rc-text); display: flex; align-items: baseline; gap: 8px; }
.mr-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }

.mr-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 20px; margin: 0; }
.mr-field { display: flex; gap: 10px; min-width: 0; }
.mr-field.is-wide { grid-column: 1 / -1; }
.mr-field dt { flex: none; width: 76px; font-size: 12px; color: var(--rc-faint); }
.mr-field dd {
  margin: 0; min-width: 0; font-size: 12px; color: var(--rc-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mr-field.is-wide dd { white-space: normal; word-break: break-word; }
.mr-field dd.is-mono { font-family: var(--rc-mono); }
.mr-field dd.is-missing { color: var(--rc-faint); }

.mr-empty {
  padding: 18px 12px; border: 1px dashed var(--rc-border-soft); border-radius: var(--rc-radius-sm);
  text-align: center; color: var(--rc-faint); font-size: 12px; line-height: 1.7;
}

.mr-hint { margin: 8px 0 0; font-size: 11.5px; color: var(--rc-faint); line-height: 1.6; font-weight: 400; }

.mr-table-wrap { overflow-x: auto; }
.mr-checks td, .mr-deliveries td { font-size: 12px; }
.mr-num { text-align: right; font-variant-numeric: tabular-nums; }
.mr-samples { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.mr-sub { margin: 12px 0 6px; font-size: 11.5px; color: var(--rc-text-2); }

/* 长日志随抽屉主容器滚动，避免日志区与抽屉同时纵向滚动。 */
.mr-code {
  margin: 0; padding: 10px 12px; border-radius: var(--rc-radius-sm);
  background: #0f172a; color: #e2e8f0; font-family: var(--rc-mono);
  font-size: 11.5px; line-height: 1.65;
  white-space: pre-wrap; word-break: break-word;
}
.mr-code-inline {
  padding: 1px 5px; border-radius: 3px; background: #f3f4f6;
  font-family: var(--rc-mono); font-size: 11px; color: var(--rc-text-2);
}
.mr-legacy {
  display: inline-block; padding: 0 5px; border-radius: 3px;
  background: #f3f4f6; border: 1px solid #e5e7eb; color: #6b7280;
  font-size: 10.5px; line-height: 16px; white-space: nowrap;
}
</style>