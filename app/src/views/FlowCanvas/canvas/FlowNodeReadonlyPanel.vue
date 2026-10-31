<script setup lang="ts">
/**
 * 只读节点配置面板（2026-10-31，流程选择弹窗的预览右侧）：对照流程工作区右侧的配置区（NodeInspector）——
 * 头部（节点名 / 类型 / 启停）、当前配置条、「节点配置 / 表配置 / 任务配置 / 编排配置」页签——只展示不编辑。
 * 工作区那套页签整体读写全局 flow store，这里只吃传入的节点配置与步骤行（理由见 FlowReadonlyCanvas）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { entryApi, type Step } from '@/api'
import {
  BIZ_TYPE_OPTIONS,
  WEB_TYPE_OPTIONS,
  conditionGroupIsSet,
  conditionGroupLabel,
  defaultMultiMode,
  nodeEntryCondition,
  nodeOutputTable,
  nodeTaskQueue,
  nodeTypeLabel,
  type NodeConfig,
} from './flowModel'
import { mergeScheduleSettings, nodeScheduleCron } from '@/utils/flow/scheduleCron'
import { isWritableStepId } from '@/utils/flow/stepPersist'

const props = defineProps<{
  nodeId: string
  cfg: NodeConfig
  step?: Step
  /** 画布推导的有效输入表（继承上游），与工作区「表配置」同口径 */
  inputTable: string
}>()

type Tab = 'node' | 'table' | 'task' | 'rule'
const tab = ref<Tab>('node')
const hasRule = computed(() => !!(props.cfg.ruleCfg || props.cfg.execCfg))
const tabs = computed<[Tab, string][]>(() => [
  ['node', '节点配置'], ['table', '表配置'], ['task', '任务配置'], ...(hasRule.value ? [['rule', '编排配置'] as [Tab, string]] : []),
])
// 换节点时回到「节点配置」；当前节点没有编排配置时也退回去
watch(() => props.nodeId, () => { tab.value = 'node' })

const tableNames = reactive<Record<string, string>>({})
function tableText(id?: string | null): string {
  if (!id) return ''
  if (!(id in tableNames)) {
    tableNames[id] = ''
    entryApi.entryDetail(id)
      .then((detail) => { tableNames[id] = detail ? (detail.name || detail.tableName || '') : '' })
      .catch(() => { tableNames[id] = '' })
  }
  return tableNames[id] ? `${tableNames[id]} (${id})` : id
}

const cc = computed(() => props.cfg.collectCfg)
const webType = computed(() => {
  if (!cc.value) return ''
  const mode = cc.value.multiMode ?? defaultMultiMode(props.cfg)
  // isMulti 0 和 2 都显示「详情页」（新平台只给两项是拍板要求）
  return WEB_TYPE_OPTIONS.find((o) => o.value === mode)?.label ?? (mode === 2 ? '详情页' : String(mode))
})
const bizType = computed(() => {
  const v = cc.value?.bizType
  return v ? (BIZ_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v) : ''
})
const condition = computed(() => {
  const group = nodeEntryCondition(props.cfg)
  return group && conditionGroupIsSet(group) ? conditionGroupLabel(group) : (props.step?.condition || '')
})
const schedule = computed(() => {
  const s = mergeScheduleSettings(props.cfg)
  const cron = nodeScheduleCron(props.cfg)
  return [s.scheduleType, cron && `cron ${cron}`].filter(Boolean).join(' · ')
})
const yesNo = (v?: boolean) => (v == null ? '' : v ? '是' : '否')

/** 各页签的行：[标签, 值]；值为空显示「—」 */
const rows = computed<[string, string][]>(() => {
  const c = props.cfg
  const s = props.step
  switch (tab.value) {
    case 'table':
      return [
        ['输入表', tableText(props.inputTable)],
        ['输出表', tableText(nodeOutputTable(c) || s?.outputTable)],
        ['去重方式', c.dedupMode === 'table' ? '按表去重' : c.dedupMode === 'source' ? '按源去重' : ''],
        ['输出字段', c.outFields?.length ? c.outFields.join('、') : ''],
      ]
    case 'task':
      return [
        ['任务队列', nodeTaskQueue(c)],
        ['URL 来源字段', c.taskCfg?.urlSourceField || s?.itemId || ''],
        ['URL 规则', c.taskCfg?.urlRule || ''],
        ['定时策略', schedule.value],
        ['失败动作', s?.failAction || ''],
      ]
    case 'rule':
      return [
        ['规则 ID', c.itemId && c.itemId !== '-1' ? c.itemId : ''],
        ['脚本', c.ruleCfg?.scriptPath || c.execCfg?.scriptPath || ''],
        ['输入表', tableText(c.ruleCfg?.inputTableId)],
        ['输出表', tableText(c.ruleCfg?.outputTableId)],
        ['模型参数', c.coreParam || ''],
      ]
    default:
      return [
        ['节点名称', c.title],
        ['节点类型', nodeTypeLabel(c)],
        ...(cc.value ? [['网页类型', webType.value], ['URL', cc.value.url || s?.url || c.configUrl || ''], ['业务类型', bizType.value]] as [string, string][] : []),
        ['进入条件', condition.value],
        ...(cc.value ? [['需要登录', yesNo(cc.value.needLogin)], ['使用代理', yesNo(cc.value.useProxy)]] as [string, string][] : []),
      ]
  }
})
</script>

<template>
  <aside class="fnp" data-testid="flow-node-panel">
    <div class="fnp-head">
      <div class="fnp-title" :title="cfg.title">{{ cfg.title }}</div>
      <div class="fnp-sub">
        <span>{{ cfg.sub || nodeTypeLabel(cfg) }}</span>
        <span v-if="isWritableStepId(nodeId)" class="fnp-stepid">#{{ nodeId }}</span>
        <span class="fnp-state" :class="{ off: cfg.disabled }">{{ cfg.disabled ? '已停用' : '启用中' }}</span>
      </div>
    </div>
    <div class="fnp-config">
      <span class="fnp-label">当前配置</span>
      <span v-if="cfg.configName" class="fnp-config-name" :title="cfg.configName">{{ cfg.configName }}</span>
      <span v-if="cfg.configId" class="fnp-config-id">#{{ cfg.configId }}</span>
      <span v-if="!cfg.configName && !cfg.configId" class="fnp-empty">未绑定配置</span>
    </div>
    <div class="fnp-tabs" role="tablist">
      <button
        v-for="[key, label] in tabs"
        :key="key"
        type="button"
        role="tab"
        class="fnp-tab"
        :class="{ active: tab === key }"
        :aria-selected="tab === key"
        :data-testid="`flow-node-tab-${key}`"
        @click="tab = key"
      >{{ label }}</button>
    </div>
    <dl class="fnp-body">
      <div v-for="[label, value] in rows" :key="label" class="fnp-row">
        <dt>{{ label }}</dt>
        <dd :class="{ empty: !value }">{{ value || '—' }}</dd>
      </div>
    </dl>
    <p class="fnp-foot">只读预览；要修改请到流程中心打开流程工作区</p>
  </aside>
</template>

<style scoped>
/* 视觉对照工作区配置区（NodeInspector 的头部 / 配置条 / 顶层页签），尺寸按弹窗收紧 */
.fnp { display: flex; flex-direction: column; min-height: 0; height: 100%; background: #fff; border-left: 1px solid var(--rc-border-soft); }
.fnp-head { flex: none; padding: 12px 14px 8px; }
.fnp-title { font-size: 14px; font-weight: 700; color: var(--rc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fnp-sub { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 11px; color: var(--rc-faint); }
.fnp-stepid { padding: 0 6px; border-radius: 5px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); font: 600 10px/16px ui-monospace, SFMono-Regular, Menlo, monospace; }
.fnp-state { margin-left: auto; padding: 0 6px; border-radius: 5px; background: var(--rc-ok-bg); color: var(--rc-ok); line-height: 16px; }
.fnp-state.off { background: #f1f5f9; color: var(--rc-muted); }
.fnp-config { flex: none; display: flex; align-items: center; gap: 6px; margin: 0 14px; padding: 7px 10px; border-radius: 7px; background: #f8fafc; font-size: 12px; min-width: 0; }
.fnp-label { flex: none; color: var(--rc-faint); }
.fnp-config-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rc-text); font-weight: 600; }
.fnp-config-id { flex: none; color: var(--rc-primary-ink); font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
.fnp-empty { color: var(--rc-faint); }
.fnp-tabs { flex: none; display: flex; gap: 2px; margin: 10px 14px 0; border-bottom: 1px solid var(--rc-border-soft); }
.fnp-tab { padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; margin-bottom: -1px; background: none; color: var(--rc-muted); font-size: 12px; font-weight: 600; cursor: pointer; }
.fnp-tab.active { border-bottom-color: var(--rc-primary); color: var(--rc-primary); }
.fnp-body { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 10px 14px; }
.fnp-row { padding: 6px 0; border-bottom: 1px dashed var(--rc-border-soft); }
.fnp-row dt { font-size: 11px; color: var(--rc-faint); }
.fnp-row dd { margin: 2px 0 0; font-size: 12px; color: var(--rc-text); word-break: break-all; line-height: 1.5; }
.fnp-row dd.empty { color: var(--rc-faint); }
.fnp-foot { flex: none; margin: 0; padding: 8px 14px; border-top: 1px solid var(--rc-border-soft); color: var(--rc-faint); font-size: 11px; }
</style>
