<script setup lang="ts">
import { computed } from 'vue'
import type { TaskInst } from '@/api'
import { toExternalHref } from '@/utils/url/externalUrl'
import { copyToClipboard } from '@/utils/clipboard'
// 数据 ID = parentId、父任务 ID = vars.pTaskId，口径见 taskIds.ts
import { taskDataId, taskParentTaskId } from './taskIds'

const props = defineProps<{
  modelValue: boolean
  task: TaskInst | null
  sourceName?: string
  stepName?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  locateData: [task: TaskInst]
  openSource: [task: TaskInst]
}>()

function textOf(value: unknown): string {
  return value == null || value === '' ? '—' : String(value)
}

function stateText(state?: TaskInst['state']): string {
  return state === 'L' ? '运行中' : state === 'E' ? '异常' : state === 'C' ? '完成' : (state || '—')
}

function stateClass(state?: TaskInst['state']): string {
  return state === 'L' ? 'run' : state === 'E' ? 'err' : 'ok'
}

type IdentityItem = {
  key: string
  label: string
  value: string
  action?: 'locateData' | 'copy' | 'url' | 'openSource'
  url?: string
}

const identityItems = computed<IdentityItem[]>(() => {
  const task = props.task
  if (!task) return []
  const taskUrlHref = toExternalHref(task.taskUrl)
  return [
    { key: 'taskId', label: '任务 ID', value: textOf(task.taskId), action: task.taskId ? 'copy' : undefined },
    { key: 'bizId', label: '数据 ID', value: textOf(taskDataId(task)), action: taskDataId(task) ? 'locateData' : undefined },
    { key: 'sourceName', label: '所属源', value: textOf(props.sourceName || task.sourceId), action: task.sourceId ? 'openSource' : undefined },
    { key: 'nodeName', label: '流程节点', value: textOf(props.stepName || task.node) },
    { key: 'topic', label: '队列', value: textOf(task.topic) },
    { key: 'parentId', label: '父任务 ID', value: textOf(taskParentTaskId(task)) },
    { key: 'fileId', label: '文件 ID', value: textOf(task.fileId) },
    { key: 'typeName', label: '任务类型', value: textOf(task.typeName) },
    { key: 'state', label: '状态', value: textOf(stateText(task.state)) },
    { key: 'taskUrl', label: '任务 URL', value: textOf(task.taskUrl), action: taskUrlHref ? 'url' : undefined, url: taskUrlHref },
  ]
})

type TimeItem = {
  key: string
  label: string
  value: string
}

const timeItems = computed<TimeItem[]>(() => {
  const task = props.task
  if (!task) return []
  return [
    { key: 'createdAt', label: '生成时间', value: textOf(task.createdAt) },
    { key: 'startedAt', label: '开始时间', value: textOf(task.startedAt) },
    { key: 'endedAt', label: '结束时间', value: textOf(task.endedAt) },
    { key: 'updatedAt', label: '更新时间', value: textOf(task.updatedAt) },
  ]
})

function formatJsonOrText(raw?: string): string {
  if (!raw || !raw.trim()) return ''
  const trimmed = raw.trim()
  try {
    const parsed = JSON.parse(trimmed)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return trimmed
  }
}

const paramsFormatted = computed(() => formatJsonOrText(props.task?.params))
const taskResultFormatted = computed(() => formatJsonOrText(props.task?.taskResult))
const varsFormatted = computed(() => formatJsonOrText(props.task?.vars))

function close() {
  emit('update:modelValue', false)
}

function onLocateData() {
  if (props.task && taskDataId(props.task)) {
    emit('locateData', props.task)
  }
}

function onOpenSource() {
  if (props.task?.sourceId) {
    emit('openSource', props.task)
  }
}

function copyField(text: string, label: string) {
  if (!text || text === '—') return
  void copyToClipboard(text, label)
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :with-header="false"
    size="560px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="task" class="ffd-detail" data-testid="task-detail-drawer">
      <div class="ffd-head">
        <div class="ffd-head-main">
          <div class="ffd-title">{{ task.taskName || `任务 ${task.taskId}` }}</div>
          <div class="ffd-sub">
            任务 ID {{ task.taskId }}
            <template v-if="taskDataId(task)"> · 数据 ID {{ taskDataId(task) }}</template>
            <template v-if="sourceName">
              · 所属源
              <button
                class="ffd-link"
                type="button"
                data-testid="task-detail-head-source-link"
                :title="`打开源: ${sourceName}`"
                @click="onOpenSource"
              >{{ sourceName }}</button>
            </template>
          </div>
        </div>
        <button class="rc-btn ghost ffd-close" type="button" @click="close">关闭</button>
      </div>

      <div class="ffd-section">标识信息</div>
      <div class="ffd-id-grid" data-testid="task-detail-identity">
        <div v-for="item in identityItems" :key="item.key" class="ffd-id-item">
          <div class="ffd-id-label">{{ item.label }}</div>
          <div class="ffd-id-value" :title="item.value">
            <template v-if="item.action === 'locateData'">
              <button
                class="ffd-link"
                type="button"
                data-testid="task-detail-biz-link"
                @click="onLocateData"
              >{{ item.value }}</button>
            </template>
            <template v-else-if="item.action === 'openSource'">
              <button
                class="ffd-link"
                type="button"
                data-testid="task-detail-source-link"
                :title="`打开源: ${item.value}`"
                @click="onOpenSource"
              >{{ item.value }}</button>
            </template>
            <template v-else-if="item.action === 'url' && item.url">
              <a
                class="ffd-link"
                :href="item.url"
                target="_blank"
                rel="noopener noreferrer"
                data-testid="task-detail-url-link"
              >{{ item.value }}</a>
            </template>
            <template v-else-if="item.action === 'copy'">
              <span :data-testid="`task-detail-${item.key}`">{{ item.value }}</span>
              <button
                class="ffd-link tdd-copy-inline"
                type="button"
                title="复制"
                @click="copyField(item.value, item.label)"
              >复制</button>
            </template>
            <template v-else-if="item.key === 'state'">
              <span class="rc-status" :class="stateClass(task.state)">
                <span v-if="task.state === 'L'" class="tv-spin" />{{ item.value }}
              </span>
            </template>
            <span v-else :data-testid="`task-detail-${item.key}`">{{ item.value }}</span>
          </div>
        </div>
      </div>

      <div class="ffd-section">执行时间</div>
      <div class="ffd-id-grid" data-testid="task-detail-times">
        <div v-for="item in timeItems" :key="item.key" class="ffd-id-item">
          <div class="ffd-id-label">{{ item.label }}</div>
          <div class="ffd-id-value" :title="item.value" :data-testid="`task-detail-${item.key}`">
            {{ item.value }}
          </div>
        </div>
      </div>

      <div class="ffd-section">排错详情</div>
      <div class="tdd-blocks" data-testid="task-detail-debug">
        <div class="tdd-block">
          <div class="tdd-block-head">
            <span class="tdd-block-title">执行结果 (taskResult)</span>
            <button
              v-if="taskResultFormatted"
              class="ffd-link"
              type="button"
              data-testid="copy-task-result"
              @click="copyField(taskResultFormatted, '执行结果')"
            >复制</button>
          </div>
          <pre v-if="taskResultFormatted" class="tdd-code" data-testid="task-result-content"><code>{{ taskResultFormatted }}</code></pre>
          <div v-else class="tdd-empty">—</div>
        </div>

        <div class="tdd-block">
          <div class="tdd-block-head">
            <span class="tdd-block-title">入参 (params)</span>
            <button
              v-if="paramsFormatted"
              class="ffd-link"
              type="button"
              data-testid="copy-params"
              @click="copyField(paramsFormatted, '入参')"
            >复制</button>
          </div>
          <pre v-if="paramsFormatted" class="tdd-code" data-testid="params-content"><code>{{ paramsFormatted }}</code></pre>
          <div v-else class="tdd-empty">—</div>
        </div>

        <div class="tdd-block">
          <div class="tdd-block-head">
            <span class="tdd-block-title">上下文变量 (vars)</span>
            <button
              v-if="varsFormatted"
              class="ffd-link"
              type="button"
              data-testid="copy-vars"
              @click="copyField(varsFormatted, '上下文变量')"
            >复制</button>
          </div>
          <pre v-if="varsFormatted" class="tdd-code" data-testid="vars-content"><code>{{ varsFormatted }}</code></pre>
          <div v-else class="tdd-empty">—</div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.ffd-detail { padding: 18px; }
.ffd-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.ffd-head-main { min-width: 0; flex: 1; }
.ffd-close { flex: none; height: 28px; padding: 0 12px; font-size: 12px; white-space: nowrap; }
.ffd-title { font-size: 14px; font-weight: 700; color: var(--rc-text); line-height: 1.4; word-break: break-word; }
.ffd-sub { margin-top: 3px; color: var(--rc-faint); font-size: 11px; }
.ffd-section { margin: 14px 0 8px; color: var(--rc-faint); font-size: 11px; letter-spacing: 0.04em; }
.ffd-id-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px; }
.ffd-id-label { color: var(--rc-muted); font-size: 11px; }
.ffd-id-value { margin-top: 2px; min-width: 0; color: var(--rc-text); font-size: 12px; word-break: break-all; }
.ffd-link { padding: 0; border: 0; background: none; color: var(--rc-primary); cursor: pointer; font-size: inherit; text-decoration: none; }
.ffd-link:hover { text-decoration: underline; }
.ffd-link:disabled { color: var(--rc-faint); cursor: default; text-decoration: none; }
.tdd-copy-inline { margin-left: 8px; font-size: 11px; }

.tdd-blocks { display: flex; flex-direction: column; gap: 12px; }
.tdd-block { padding: 8px 0; border-bottom: 1px solid var(--rc-border-soft); }
.tdd-block:last-child { border-bottom: none; }
.tdd-block-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.tdd-block-title { font-size: 12px; font-weight: 600; color: var(--rc-text); }
.tdd-code {
  margin: 0;
  padding: 8px 10px;
  background: #f8fafc;
  border: 1px solid var(--rc-border-soft);
  border-radius: 6px;
  font-family: var(--rc-mono, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--rc-text-2);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 220px;
  overflow-y: auto;
}
.tdd-empty { color: var(--rc-faint); font-size: 12px; }
.rc-btn.ghost { border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.tv-spin { display: inline-block; width: 9px; height: 9px; margin-right: 4px; border: 1.5px solid currentColor; border-top-color: transparent; border-radius: 50%; animation: tv-spin 0.7s linear infinite; vertical-align: -1px; }
@keyframes tv-spin { to { transform: rotate(360deg); } }
</style>
