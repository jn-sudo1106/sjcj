<script setup lang="ts">
// 监控配置（0916）：监控视图的第二个 Tab，口径对齐单源画布里的「监控配置」Tab
//（MonitorConfigView = AlertConfigPanel + 当前数据监控节点），只是把节点选择搬到了本组件里——
// 网站汇总态没有画布，用户没法先点节点再切 Tab。
//
// 取数是 SiteDataView 那套约定：本组件的源/节点数据是**本地状态**，并行拉
// sourceDetail/sourceSteps 后用纯函数 buildSourceSeed 拼骨架，**不碰全局 useFlowStore()**
//（那是主画布正在编辑的对象，网站态下它连源上下文都是空的）。
//
// 保存语义要说清（与单源画布不完全一样）：单源那边改的是画布上的节点，落库要等「保存节点配置」；
// 这里没有画布，点「保存配置」直接写 ck_source（syncMonitorAlertConfig）。
// 因此**只有真改过才让保存**——面板一挂载就会 emit 一次初始快照，那次是演示默认策略，
// 拿着它去写会把线上监控真实的阈值/条件覆盖掉（checkConf 的 minSize/cond）。
//
// 第一期只做告警配置（策略 + 通知渠道），监控方法 / 调度仍在画布的节点配置里改。
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { sourceApi, type Source, type Step } from '@/api'
import { buildSourceSeed, isMonitorNode, type NodeConfig, type MonitorAlertConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { syncMonitorAlertConfig } from '@/utils/flow/monitorCkSource'
import AlertConfigPanel from '@/views/FlowCanvas/inspector/AlertConfigPanel.vue'
import SiteSourceSelect from './components/SiteSourceSelect.vue'

const props = defineProps<{ siteId: string; sourceId: string }>()
const emit = defineEmits<{ 'update:sourceId': [sourceId: string] }>()
const selectedSourceId = computed({
  get: () => props.sourceId,
  set: (value: string) => emit('update:sourceId', value),
})

const flowLoading = ref(false)
const flowError = ref('')
const sourceName = ref('')
const main = ref<string[]>([])
const configs = ref<Record<string, NodeConfig>>({})
const selectedNodeId = ref('')

const monitors = computed(() => main.value
  .filter((id) => isMonitorNode(configs.value[id]))
  .map((id) => ({ id, title: configs.value[id]?.title || id })))
const node = computed<NodeConfig | undefined>(() => configs.value[selectedNodeId.value])

/** 与 MonitorConfigView 同口径：`源名 / 输入表`，让面板上下文能对上单源画布那一版 */
const sourceLabel = computed(() => {
  const cfg = node.value
  const table = cfg?.collectCfg?.inputTable?.trim()
    || cfg?.inputTable?.trim()
    || cfg?.ruleCfg?.inputTable?.trim()
    || cfg?.ruleCfg?.inputTableId?.trim()
    || ''
  return [sourceName.value, table].filter(Boolean).join(' / ')
})

let requestId = 0
async function loadFlow(sourceId: string) {
  const id = ++requestId
  flowLoading.value = true
  flowError.value = ''
  main.value = []
  configs.value = {}
  selectedNodeId.value = ''
  sourceName.value = ''
  try {
    const [source, steps] = await Promise.all([
      sourceApi.sourceDetail(sourceId),
      sourceApi.sourceSteps(sourceId),
    ])
    if (id !== requestId) return
    if (!source) {
      flowError.value = '源不存在或加载失败'
      return
    }
    const seed = buildSourceSeed(source as Source, (steps ?? []) as Step[])
    main.value = seed.main
    configs.value = seed.configs
    sourceName.value = source.name
    // 只有节点一个的源是常态（多数源就一个数据监控节点），默认选中省一次点击。
    selectedNodeId.value = seed.main.find((nodeId) => isMonitorNode(seed.configs[nodeId])) ?? ''
  } catch (e) {
    if (id !== requestId) return
    flowError.value = e instanceof Error ? `监控配置加载失败：${e.message}` : '监控配置加载失败，请重试'
  } finally {
    if (id === requestId) flowLoading.value = false
  }
}

// ---- 告警配置快照 ----
// 面板每次变更（含挂载时那一次）都会 emit 整份快照，这里记下"本节点第一次拿到的"当基线，
// 只有跟基线不一样才算改过、才允许保存。
// 声明要放在下面那两个 immediate watch 之前：它们开局就会调 resetSnapshot()，
// 晚于 watch 声明的话会踩到 TDZ（Cannot access 'snapshot' before initialization）。
const snapshot = ref<MonitorAlertConfig | null>(null)
const baselineJson = ref('')
const baselineKey = ref('')
const panelKey = computed(() => `${props.sourceId}::${selectedNodeId.value}`)
const dirty = computed(() => !!snapshot.value && JSON.stringify(snapshot.value) !== baselineJson.value)

function resetSnapshot() {
  snapshot.value = null
  baselineJson.value = ''
  baselineKey.value = ''
}

watch(selectedSourceId, (sourceId) => {
  resetSnapshot()
  if (sourceId) void loadFlow(sourceId)
  else {
    main.value = []
    configs.value = {}
    selectedNodeId.value = ''
    flowError.value = ''
  }
}, { immediate: true })
watch(() => props.siteId, () => {
  resetSnapshot()
})

function onAlertConfig(next: MonitorAlertConfig) {
  snapshot.value = next
  if (baselineKey.value !== panelKey.value) {
    baselineKey.value = panelKey.value
    baselineJson.value = JSON.stringify(next)
  }
}

const saving = ref(false)
async function save() {
  const cfg = node.value
  if (!cfg || !snapshot.value) return
  saving.value = true
  try {
    await syncMonitorAlertConfig(props.sourceId, cfg, snapshot.value)
    baselineJson.value = JSON.stringify(snapshot.value)
    ElMessage.success('监控配置已保存')
  } catch (e) {
    ElMessage.error(`监控配置保存失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="smc-shell">
    <div class="smc-toolbar">
      <SiteSourceSelect v-model="selectedSourceId" :site-id="siteId" />
      <template v-if="selectedSourceId && monitors.length">
        <select v-model="selectedNodeId" class="smc-input" aria-label="数据监控节点">
          <option v-for="item in monitors" :key="item.id" :value="item.id">{{ item.title }}</option>
        </select>
        <button
          class="rc-btn primary"
          type="button"
          data-testid="site-monitor-config-save"
          :disabled="!dirty || saving"
          :title="dirty ? '' : '改动告警策略或通知渠道后即可保存'"
          @click="save"
        >{{ saving ? '保存中…' : '保存配置' }}</button>
      </template>
    </div>

    <div v-if="!selectedSourceId" class="smc-empty" data-testid="site-monitor-need-source">请先选择源，再配置该源的数据监控告警。</div>
    <div v-else-if="flowLoading" class="smc-empty">正在加载监控配置…</div>
    <div v-else-if="flowError" class="smc-empty">
      <div>{{ flowError }}</div>
      <button class="rc-btn" type="button" @click="loadFlow(selectedSourceId)">重试</button>
    </div>
    <div v-else-if="!monitors.length" class="smc-empty" data-testid="site-monitor-no-node">
      该源还没有数据监控节点。在流程画布中插入「数据监控」节点并保存后，这里就能配置告警。
    </div>
    <div v-else class="smc-body">
      <AlertConfigPanel
        :key="panelKey"
        :node-id="selectedNodeId"
        :node-title="node?.title ?? ''"
        :source-label="sourceLabel"
        :script-path="node?.ruleCfg?.scriptPath ?? ''"
        @update:alert-config="onAlertConfig"
      />
    </div>
  </div>
</template>

<style scoped>
.smc-shell { display: flex; flex-direction: column; min-height: 0; flex: 1; background: #fff; }
.smc-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.smc-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); font-size: 12px; outline: none; min-width: 180px; max-width: 320px; background: #fff; }
.smc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.smc-toolbar .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.smc-body { flex: 1; min-height: 0; overflow: auto; }
.smc-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; color: var(--rc-faint); font-size: 12.5px; text-align: center; }
</style>
