<script setup lang="ts">
// 监控配置编辑器（0916 起是监控视图「监控配置」Tab 的主体；**2026-09-18 改版**搬进
// 「新增配置 / 编辑配置」弹窗里——Tab 页面本身改成 ck_source 分页列表，本组件就是弹窗的内容）。
//
// **0917 起内容改版**——不再只有告警面板，而是把数据监控节点右侧「编排配置」那一整屏搬过来
// （监控方法 / 设置业务规则 / 模型供应商 / 模型 / 生成脚本 / 测试脚本 / 告警配置），
// 跟画布上看到的是同一套 UI（RuleOrchestrationTab），用户不用再"回画布找那个节点"才能改监控。
//
// 取数是 SiteDataView 那套约定：本组件的源/节点数据是**本地状态**，并行拉
// sourceDetail/sourceSteps 后用纯函数 buildSourceSeed 拼骨架，**不碰全局 useFlowStore()**
//（那是主画布正在编辑的对象，网站态下它连源上下文都是空的）。
// 编排 Tab 照样写不到 store：它通过 nodeEditorContext 拿编辑对象，本组件 provide 一份本地实现，
// 改动只落在这份 seed 上，见下面的 localEditorContext。
//
// **页面展示不跟"源上有没有数据监控节点"绑**（0917 用户口径）：源上没有该节点、或者一个源
// 都还没选，页面照样把整套控件铺出来，编辑对象是一份**本地的空监控节点草稿**（见 draftNode）。
// 即"没有数据监控节点也可以配置监控"。草稿态的落库通路后续再定，这里只保证界面完整、可编辑。
//
// 保存语义（有真实监控节点时）：
//   · 画布上改的是节点，落库要等「保存节点配置」/「保存脚本」（后者顺带 syncMonitorCkSource）；
//   · 这里点顶部「保存配置」直接写 ck_source，分两条通路：
//       只动过告警面板 → syncMonitorAlertConfig（只合入告警字段，监控方法/编排原样保留）；
//       动过监控方法/描述/脚本等 → syncMonitorCkSource 整包写。
//     告警字段**只有用户真动过面板才写**：面板永远是拿演示默认策略起手的，不看改动就写，
//     等于把线上监控真实的阈值/条件覆盖掉（0916 起就有这条红线，见 monitorCkSource.ts）。
//   · 草稿态一律走 syncMonitorAlertConfig：手上没有真实节点，整包写会把线上真实的
//     监控方法/脚本路径覆盖成默认空值。
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { entryApi, sourceApi, type Source, type Step } from '@/api'
import { buildSourceSeed, cloneConfig, isMonitorNode, isRuleNode, NODE_CONFIGS, type NodeConfig, type MonitorAlertConfig } from '@/views/FlowCanvas/canvas/flowModel'
import type { RuleOrchestration } from '@/api'
import { syncMonitorAlertConfig, syncMonitorCkSource } from '@/utils/flow/monitorCkSource'
import { provideNodeEditorContext } from '@/views/FlowCanvas/inspector/nodeEditorContext'
import { provideNodeInspectorAssets } from '@/views/FlowCanvas/inspector/useNodeInspectorAssets'
import { mergeEntryTypesPreservingFields } from '@/composables/useEntryTableFieldsCache'
import RuleOrchestrationTab from '@/views/FlowCanvas/inspector/tabs/RuleOrchestrationTab.vue'
import SiteSourceSelect from './components/SiteSourceSelect.vue'

const props = withDefaults(defineProps<{ siteId: string; sourceId?: string }>(), { sourceId: '' })
const emit = defineEmits<{ saved: [] }>()

/**
 * 本档实际在看的源：弹窗打开时由父级带入（「编辑」带该行 sourceId，「新增」为空 = 全部源），
 * 之后在**下拉框里手选**才切换。不再往上 emit——监控结果那个共用筛选条件与本档无关了。
 */
const selectedSourceId = ref(props.sourceId || '')
function pickSource(value: string) {
  selectedSourceId.value = value
}

const flowLoading = ref(false)
const flowError = ref('')
const source = ref<Source | null>(null)
const main = ref<string[]>([])
const configs = ref<Record<string, NodeConfig>>({})
const selectedNodeId = ref('')

/**
 * 草稿监控节点：源上还没有数据监控节点（或还没选源）时，给它一个**可编辑的空监控节点**，
 * 让整套控件照样渲染出来——"没有数据监控节点也可以配置监控"（0917 用户口径）。
 *
 * 复用规则节点种子 + `template='monitor'`：正是画布上新建数据监控节点时的那份默认值
 *（monitor 与 rule 共用同一个种子，见 flowModel 的 TEMPLATE_TO_NODE），所以界面上的
 * 监控方法与告警面板跟画布一模一样，不是另做一套空壳。
 */
const DRAFT_NODE_ID = '__draft_monitor__'
function makeDraftNode(): NodeConfig {
  const node = cloneConfig(NODE_CONFIGS.rule)
  node.template = 'monitor'
  node.title = '数据监控'
  node.disabled = false
  return node
}
const isDraftNode = computed(() => selectedNodeId.value === DRAFT_NODE_ID)

const monitors = computed(() => main.value
  .filter((id) => isMonitorNode(configs.value[id]))
  .map((id) => ({ id, title: configs.value[id]?.title || id })))
/** 节点下拉的候选：源上没有监控节点时给出草稿那一项，界面不留空 */
const nodeOptions = computed(() => (monitors.value.length ? monitors.value : [{ id: DRAFT_NODE_ID, title: '数据监控' }]))
const node = computed<NodeConfig | undefined>(() => configs.value[selectedNodeId.value])

/** 把草稿节点挂进本地种子并选中它（源上没有监控节点、以及一个源都没选时的统一落点） */
function useDraftNode() {
  configs.value = { ...configs.value, [DRAFT_NODE_ID]: makeDraftNode() }
  main.value = main.value.includes(DRAFT_NODE_ID) ? main.value : [...main.value, DRAFT_NODE_ID]
  selectedNodeId.value = DRAFT_NODE_ID
  resetBaseline()
}

/**
 * 编排 Tab 要的表清单（`resolveTableLabel` 把输入表 id 翻成人看得懂的名字）。
 * 画布侧由 NodeInspector 主壳拉一次并 provide，这里没有那个主壳，就地补一份——
 * 拉不到不阻塞页面，表名退化成 id（Tab 里本来就有这个兜底）。
 */
const assets = provideNodeInspectorAssets()
onMounted(() => {
  void entryApi.entryPaged({ size: 100 })
    .then((r) => { assets.tables.value = mergeEntryTypesPreservingFields(assets.tables.value, r.list) })
    .catch(() => { /* 表清单只是展示友好度，失败不提示 */ })
})
/** 本地节点改动：整节点替换（不是就地改），保证 Tab 里那些 computed 能重新求值。 */
function setNode(id: string, patch: Partial<NodeConfig>) {
  const current = configs.value[id]
  if (!current) return
  configs.value = { ...configs.value, [id]: { ...current, ...patch } }
}

/**
 * 告警面板的 emit 计数：**第一次是挂载快照**（面板 always 拿演示默认策略起手），
 * 之后每一次都意味着用户真的改过。只有改过才允许写告警字段。
 */
let alertEmitCount = 0
function resetAlertTracking() {
  alertEmitCount = 0
  alertTouched.value = false
}

/**
 * 给 RuleOrchestrationTab 用的编辑上下文：读写都落在本组件这份 seed 上，
 * 跟画布的唯一区别是"写回哪里"，UI/接口调用完全一致（见 nodeEditorContext.ts）。
 */
provideNodeEditorContext({
  id: selectedNodeId,
  cfg: node,
  patch: (p: Partial<RuleOrchestration>) => {
    const current = configs.value[selectedNodeId.value]
    if (!current) return
    const key = isRuleNode(current) ? 'ruleCfg' : 'execCfg'
    setNode(selectedNodeId.value, { [key]: { ...(current[key] ?? {}), ...p } } as Partial<NodeConfig>)
  },
  setMonitorMethods: (values: string[]) => {
    setNode(selectedNodeId.value, { monitorMethods: [...new Set((values ?? []).filter(Boolean))] })
  },
  setMonitorAlertConfig: (config: MonitorAlertConfig) => {
    alertEmitCount += 1
    if (alertEmitCount > 1) alertTouched.value = true
    setNode(selectedNodeId.value, { alertConfig: JSON.parse(JSON.stringify(config)) as MonitorAlertConfig })
  },
  sourceId: computed(() => selectedSourceId.value),
  sourceSchedule: source,
})

let requestId = 0
async function loadFlow(sourceId: string) {
  const id = ++requestId
  flowLoading.value = true
  flowError.value = ''
  main.value = []
  configs.value = {}
  selectedNodeId.value = ''
  source.value = null
  resetAlertTracking()
  try {
    const [detail, steps] = await Promise.all([
      sourceApi.sourceDetail(sourceId),
      sourceApi.sourceSteps(sourceId),
    ])
    if (id !== requestId) return
    if (!detail) {
      flowError.value = '源不存在或加载失败'
      return
    }
    const seed = buildSourceSeed(detail as Source, (steps ?? []) as Step[])
    main.value = seed.main
    configs.value = seed.configs
    source.value = detail as Source
    // 源上有数据监控节点就用真实的那个（多数源只有一个，直接选中省一次点击）；
    // 没有就给一份草稿节点，页面照样是完整的配置界面（0917 用户口径）。
    const firstMonitor = seed.main.find((nodeId) => isMonitorNode(seed.configs[nodeId]))
    if (firstMonitor) {
      selectedNodeId.value = firstMonitor
      resetBaseline()
    } else {
      useDraftNode()
    }
  } catch (e) {
    if (id !== requestId) return
    flowError.value = e instanceof Error ? `监控配置加载失败：${e.message}` : '监控配置加载失败，请重试'
  } finally {
    if (id === requestId) flowLoading.value = false
  }
}

// ---- 源下拉的初始态 = **全部源**（0917 用户口径）----
// 不再自动预置某个源：进来就是"全部源"，配的是哪份配置由用户自己挑源时决定；
// 没选源照样是完整的配置界面（草稿节点兜底），所以"全部源"不再是空态、不需要替他选。
// 下面 selectedSourceId 的 watcher 里，空源这一支就是"全部源"的渲染路径。

// ---- 改动判定 ----
// 节点基线 = 种子原样，**排除 alertConfig**：告警那部分单独由 alertTouched 表达
//（面板挂载就会 emit 一次演示默认值，把它算进节点差异会让"还没动过"看起来像"改过了"）。
// 基线之外的差异来自用户编辑、以及编排 Tab 的异步回填（描述/脚本路径/监控方法）——
// 那些值就摆在界面上，算作可保存的当前态是合理的。
const baselineJson = ref('')
const alertTouched = ref(false)
const saving = ref(false)

function withoutAlert(cfg: NodeConfig | undefined): string {
  if (!cfg) return ''
  return JSON.stringify(cfg, (key, value) => (key === 'alertConfig' ? undefined : value))
}
const nodeConfigDirty = computed(() => !!selectedNodeId.value && withoutAlert(node.value) !== baselineJson.value)
const dirty = computed(() => alertTouched.value || nodeConfigDirty.value)
/** 没选源就没有落库目标，按钮只做展示 */
const canSave = computed(() => !!selectedSourceId.value && dirty.value && !saving.value)

function resetBaseline() {
  baselineJson.value = withoutAlert(configs.value[selectedNodeId.value])
}
watch(selectedNodeId, () => {
  resetAlertTracking()
  resetBaseline()
})

/**
 * 保存：只动过告警、或手上是草稿节点 → 只合入告警字段；真实节点动了编排 → 整包写 ck_source。
 *
 * 草稿态（源上没有数据监控节点）必须走窄通路：监控方法/编排在草稿里是默认值，
 * 整包写会把 ck_source 里真实存在的脚本路径、监控方法覆盖成空。
 */
async function save() {
  const cfg = node.value
  if (!cfg || !selectedSourceId.value) return
  saving.value = true
  try {
    if (isDraftNode.value || (alertTouched.value && !nodeConfigDirty.value)) {
      await syncMonitorAlertConfig(selectedSourceId.value, cfg, cfg.alertConfig)
    } else {
      // 告警没动过就别带上去：buildCheckConf 会把 previous 里的告警键补回来，
      // 带上就等于拿面板里的演示默认值覆盖线上真实阈值。
      await syncMonitorCkSource(
        selectedSourceId.value,
        alertTouched.value ? cfg : { ...cfg, alertConfig: undefined },
        source.value,
      )
    }
    resetBaseline()
    alertTouched.value = false
    alertEmitCount = 1
    ElMessage.success('监控配置已保存')
    emit('saved')
  } catch (e) {
    ElMessage.error(`监控配置保存失败：${e instanceof Error ? e.message : String(e)}`)
  } finally {
    saving.value = false
  }
}

watch(selectedSourceId, (sourceId) => {
  if (sourceId) void loadFlow(sourceId)
  else {
    // 「全部源」：没有具体源可读，直接给草稿节点——页面照样是完整的配置界面，只是没有落库目标
    source.value = null
    flowError.value = ''
    resetAlertTracking()
    useDraftNode()
  }
}, { immediate: true })
</script>

<template>
  <div class="smc-shell">
    <div class="smc-toolbar">
      <SiteSourceSelect :model-value="selectedSourceId" :site-id="siteId" @update:model-value="pickSource" />
      <select v-if="nodeOptions.length" v-model="selectedNodeId" class="smc-input" aria-label="数据监控节点">
        <option v-for="item in nodeOptions" :key="item.id" :value="item.id">{{ item.title }}</option>
      </select>
      <span v-if="isDraftNode" class="smc-draft-note" data-testid="site-monitor-draft-note">
        {{ selectedSourceId ? '该源还没有数据监控节点，可先在这里配置监控' : '选个源即可把这份配置落到该源上' }}
      </span>
      <button
        class="rc-btn primary"
        type="button"
        data-testid="site-monitor-config-save"
        :disabled="!canSave"
        :title="selectedSourceId ? (dirty ? '' : '改动监控方法、描述或告警配置后即可保存') : '先选择源'"
        @click="save"
      >{{ saving ? '保存中…' : '保存配置' }}</button>
    </div>

    <div v-if="flowLoading" class="smc-empty">正在加载监控配置…</div>
    <div v-else-if="flowError" class="smc-empty">
      <div>{{ flowError }}</div>
      <button class="rc-btn" type="button" @click="loadFlow(selectedSourceId)">重试</button>
    </div>
    <!-- 控件常驻（0917 用户口径）：源上没有数据监控节点、甚至还没选源，页面照样给全套配置项，
         编辑对象是本地草稿节点（见 useDraftNode）。
         「上传 Excel」不用在这里额外关：草稿/真实节点都是数据监控节点，编排 Tab 本身就不给这一档渲染。
         key 带节点 id：切节点时整块重挂，编排 Tab 内部那些"按节点初始化"的 ref/watch 才能回到初值 -->
    <div v-else class="smc-body">
      <RuleOrchestrationTab :key="`${selectedSourceId}::${selectedNodeId}`" />
    </div>
  </div>
</template>

<style scoped>
.smc-shell { display: flex; flex-direction: column; min-height: 0; flex: 1; background: #fff; }
.smc-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; }
.smc-draft-note { color: var(--rc-faint); font-size: 11px; }
.smc-input { height: 28px; padding: 0 10px; border: 1px solid var(--rc-border); border-radius: var(--rc-radius-sm); font-size: 12px; outline: none; min-width: 180px; max-width: 320px; background: #fff; }
.smc-input:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.smc-toolbar .rc-btn { height: 28px; padding: 0 14px; font-size: 12px; }
.smc-toolbar .rc-btn.primary { margin-left: auto; }
.smc-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
.smc-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 48px 24px; color: var(--rc-faint); font-size: 12.5px; text-align: center; }
</style>
