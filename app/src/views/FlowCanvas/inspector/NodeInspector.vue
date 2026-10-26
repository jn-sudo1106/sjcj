<script setup lang="ts">
// NodeInspector 主壳（P1-1 Step 4 · 拆 tab 子组件后的瘦壳）。
// 职责：① 加载并提供资产（tables/params/ruleGroups/rules/sharedCfgs）；
//       ② 顶层 Tab 切换；③ 节点头（标题/启停/展开）。各 Tab 的字段级逻辑在 tabs/*.vue 里。
// 规则资产的懒加载逻辑必须留主壳：NodeInspector 只 mount 一次（index.vue 没给 :key），
// isRule 会随选中节点变化，不能只在 onMounted 判断一次——否则打开画布时没选中规则节点就永远拉不到规则数据
// （见 NodeInspector.test.ts「规则数据懒加载」）。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import { useUiStore } from '@/stores/ui'
import { canvasFlowIdOf, useFlowVersionStore } from '@/stores/flowVersion'
import { cronSaveErrorHint, unpublishedFlowCronHint } from '@/utils/flow/cronSaveHint'
import { isDataValidationNode, isMonitorNode, isRuleNode, nodeTypeLabel, NODE_CONFIGS, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { isSyntheticRootId, isWritableStepId, outputTableMissing, persistableNodeIds } from '@/utils/flow/stepPersist'
import { nodeStatusOf } from '@/views/FlowCanvas/canvas/nodeStatus'
import { inputTableMismatch } from '@/utils/flow/tableSync'
import { nodeInspectorTabs } from './nodeInspectorTabs'
import { configApi, entryApi, paramApi, ruleApi, sourceApi } from '@/api'
import { provideNodeInspectorAssets } from './useNodeInspectorAssets'
import { mergeEntryTypesPreservingFields } from '@/composables/useEntryTableFieldsCache'
import { buildConfigPayload } from '@/utils/flow/nodeConfigPayload'
import { syncNodeDeployment } from '@/utils/flow/nodeDeployment'
import { refreshConfigUpdateDt } from '@/utils/flow/configVersion'
import { assertConfigWritable, detachFailureFor } from '@/utils/flow/copiedConfigs'
import { syncMonitorCkSource } from '@/utils/flow/monitorCkSource'
import { nodeScheduleCron } from '@/utils/flow/scheduleCron'
import { validateTableBinding } from '@/utils/flow/ruleOrchestration'
import { enqueueConfigSave, isActiveNodeConfigFlusher, registerNodeConfigFlusher } from './nodeConfigAutosave'
import NodeAiChat from './NodeAiChat.vue'
import NodeConfigSelect from './NodeConfigSelect.vue'
import TaskTab from './tabs/TaskTab.vue'
import TableTab from './tabs/TableTab.vue'
import ConfigTab from './tabs/ConfigTab.vue'
import RuleOrchestrationTab from './tabs/RuleOrchestrationTab.vue'
import { shortTime, versionCutoff } from '@/views/FlowCenter/flowVersionHistory'

const props = withDefaults(defineProps<{ hideAi?: boolean }>(), { hideAi: false })
const flow = useFlowStore()
// 只读（2026-10-10，10-11 起 217 发布版可直接改、首次保存自动生成草稿）：217 的锁定草稿，以及 leo 版本状态
// 里的已发布版。只读也要能滚动、
// 切页签、展开收起查看——原来外层整块 pointer-events: none，连滚动条都拖不动（用户反馈）。
// 现在只让内容区本身不接收鼠标（滚轮落到外层滚动容器照常滚），启停 / 更换配置 / 保存单独禁用。
const flowVersion = useFlowVersionStore()
const readonly = computed(() => (flow.sourceCtx?.workflowVersionManaged !== false && flow.sourceCtx?.workflowVersionStatus === 'PUBLISHED')
  || (flowVersion.readonly && flowVersion.flowId === canvasFlowIdOf(flow)))
const sourceStore = useSourceStore()
const ui = useUiStore()
const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const tab = computed<string>(() => flow.activeTab)

// 与画布卡片同一口径（nodeStatusOf），不直接显示种子里的占位 status
const nodeStatus = computed(() => (cfg.value ? nodeStatusOf(cfg.value) : null))
const statusText = computed(() => nodeStatus.value?.left ?? '')
const statusClass = computed(() => (nodeStatus.value && ['运行', '运行中'].includes(nodeStatus.value.left) ? 'ok' : 'warn'))

// 顶层 Tab：参数字段已并入任务配置。
const TOP_TABS = computed(() => nodeInspectorTabs(cfg.value, { includeAi: !props.hideAi }))
watch(() => props.hideAi, (hideAi) => {
  if (hideAi && flow.activeTab === 'ai') flow.setActiveTab('config')
}, { immediate: true })
// 没有选中节点时自动选第一个（1008-08，会上要求取消「未选择」状态）：流程里只要有真实节点，
// 检查器就不该停在「未选择节点」——新建、重载、切换、选中的节点被删后都走这一条兜底。
// 「未选择节点」空态只留给一个节点都没有的流程。
watch(
  [() => flow.selectedId, () => flow.main, () => Object.keys(flow.configs).length],
  () => {
    if (flow.selectedId && flow.configs[flow.selectedId]) return
    const first = flow.main.find((id) => id !== 'start' && id !== 'end' && flow.configs[id])
    if (first) flow.select(first)
  },
  { immediate: true, deep: true },
)
// 旧会话若停在已移除的 params Tab，直接迁到任务配置（挂载即生效）。
watch(() => flow.activeTab, (active) => {
  if (active !== 'params') return
  const fallback = TOP_TABS.value.find((t) => t[0] === 'task' && !t[2]) ?? TOP_TABS.value.find((t) => !t[2])
  if (fallback) flow.setActiveTab(fallback[0])
}, { immediate: true })
// 切换节点时，当前 Tab 在新节点上不存在或被禁用才回落到第一个可用 Tab。
// 不在挂载 / Tab 列表变化时立即回落：编排配置的门禁会随表配置编辑反复开关，立即回落会把人从正在看的页上踢走。
watch(() => flow.selectedId, () => {
  const current = TOP_TABS.value.find((t) => t[0] === flow.activeTab)
  if (current && !current[2]) return
  const fallback = TOP_TABS.value.find((t) => !t[2])
  if (fallback) flow.setActiveTab(fallback[0])
})

// 配置绑定条（0824-00 §6.1）：一个 FlowNode 必须且只能引用一个 Config。
// 本期只落骨架——configId 来自迁移回填（flowModel.ts NodeConfig.configId），
// 配置名称/使用节点数/状态要等 config/configDetail 与使用范围接口（0824-07 §5），拿不到就不渲染，不填占位 0。
// 当前节点输出表未就绪；文件下载同样按 entry 校验，废弃 type=file 不再提供豁免。
// 自动保存会跳过该节点并置头部 pending「请先补全节点配置」；这里常驻提示引导去「表配置」。
// 0927（H1 修订）：数据监控节点「不落表/不出参」——它的表在编排配置 tab 的监控方法里绑，
// 输出表恒等于输入表（后端监控步骤行 outputTable=inputTable），表配置里没有「输出表」
// 选择器，这里提示「去表配置选输出表」是死路；只豁免展示侧（写侧 outputTableMissing 跳过
// 语义不变：未配输入表的新监控节点本就落不了库，落库后快照 outputTable 兜底照常回写）。
// 0928 表联动：用户自己指定的输入表与上游输出表不一致——上游变动（插入 / 删除 / 改表）时本节点
// 不会自动跟随，常驻提示一句，免得以为改了上游下游会跟着变。
const inputMismatch = computed(() => (id.value
  ? inputTableMismatch({ main: flow.main, branches: flow.branches, configs: flow.configs, branchGroups: flow.branchGroups }, id.value)
  : null))
const outputTableWarning = computed(() => {
  const node = cfg.value
  if (!node) return false
  const snapshot = sourceStore.stepSnapshots[id.value]
  if (isMonitorNode(node)) return false
  return outputTableMissing(node, snapshot)
})
// 2026-10-15：启用版本的流程缺输出表也能存进草稿，只在发布 / 发起抓取前拦；未启用版本时后端仍拒，自动保存跳过该节点
const outputTableWarningText = computed(() => (flowVersion.allowsEmptyOutput(canvasFlowIdOf(flow))
  ? '节点已可保存到草稿，但发布和发起抓取前必须选择输出表，请在「表配置」补上'
  : '当前步骤保存时必须声明输出表（OUT_ENTRY）。该节点会自动跳过保存，请在「表配置」选择输出表后重试'))
const configId = computed(() => cfg.value?.configId || '')
// sourceId 视角下，后端会把源自身的 config 套成 itemConfig=0 的虚拟首节点。
// 新建采集走 snatchSave(newConfig=1)，这份配置就是随源刚创建的；仅凭“已有 configId”把它
// 标成「已有配置」会误导成复用了历史配置。更换为其它 configId 后才属于「已有配置」。
const isInitialSourceConfig = computed(() => {
  const source = flow.sourceCfg ?? flow.sourceCtx
  const nodeId = id.value
  return !!configId.value
    && !!source?.configId
    && configId.value === source.configId
    && (nodeId === '0' || nodeId.startsWith('source:'))
    // 跑过的源（有任务 / 成功记录或已入库数据）不是"随源刚建"——首节点配置对它就是「已有配置」。
    // 首节点配置 == 源自身 configId 对新老源都恒真，光靠它会把所有已有源都误标「新建配置」。
    && !source.lastTaskAt
    && !source.lastSuccessAt
    && !(Number(source.dataCount) > 0)
})
const configOriginText = computed(() => {
  if (!configId.value) return '新建配置 · 未保存'
  return isInitialSourceConfig.value ? '新建配置' : '已有配置'
})

// 0929 F2：复制流程/套用模板时配置复制失败、仍与来源共享的配置——常驻提示 + 保存前知情确认。
// 场景口径：直接改共享配置 = 所有使用者一起变（默认意图）；复制出来的流程必须互不影响（红线），
// 所以残留共享的步骤会被这里盯住（登记表见 utils/flow/copiedConfigs.ts）。按画布当前流程精确匹配，
// 同一配置在其它流程里的登记不影响本流程的提示/清除。
const sharedConfigWarning = computed(() => detachFailureFor(configId.value, flow.flowId))

// 双层脏状态（0824-00 §5.4）：本条只管当前节点的配置表单；流程脏标在画布 Header。
const nodeConfigDirty = computed(() => flow.dirtyConfigNodes.includes(id.value))
// 底部条常驻（不只在脏时出现）：新加的节点默认「新建配置」态，一个字段没改也要能保存一次拿 configId
// （0824-00 §5.3）；脏标只影响文案和按钮可用性。
// 配置名称跟节点名走（新增/复制时已写上），不再在节点配置 Tab 里填；保存时若仍为空就用节点名补上。
// 配置身份（新建 / 已有）由上面的配置绑定条表达，这里只说"有没有未提交的修改"，不重复也不夸大落库状态。
// 其余节点还有没存的（新节点没配置 / 配置有改动）时，当前节点干净也要能点保存——保存是整张画布一起存。
const otherNodesPending = computed(() => persistableNodeIds(flow.main, flow.branchGroups).some((nodeId) => {
  if (nodeId === id.value || nodeId === 'start' || nodeId === 'end' || nodeId === '0' || isSyntheticRootId(nodeId)) return false
  const node = flow.configs[nodeId]
  if (!node) return false
  return node.configId ? flow.dirtyConfigNodes.includes(nodeId) : !isWritableStepId(nodeId)
}))
const canSaveNodeConfig = computed(() => nodeConfigDirty.value || !configId.value || otherNodesPending.value || !!deploymentError.value)
const viewingHistory = computed(() => !!flowVersion.history && flowVersion.flowId === canvasFlowIdOf(flow))
const footNote = computed(() => (viewingHistory.value
  ? '正在查看历史版本，只能查看'
  : readonly.value ? '当前版本只读（草稿已锁定或为已发布版本），不能修改'
    : deploymentError.value ? '配置已保存，部署配置同步失败，可重试'
      : nodeConfigDirty.value ? (configId.value ? '有未保存修改，切换节点时自动保存' : '有未保存修改（新节点需点保存）')
        : autoSavedAt.value[id.value] ? `已自动保存 ${autoSavedAt.value[id.value]}` : '无未保存修改'))
/** 查看历史版本时：节点配置不随版本保存（217 实测），配置在该版本之后改过就提示一句（2026-10-14） */
const historyConfigNote = computed(() => {
  const row = viewingHistory.value ? flowVersion.history : undefined
  const cutoff = row ? versionCutoff(row) : null
  const updated = cfg.value?.configUpdateDt
  if (!cutoff || !updated || updated.slice(0, 19) <= cutoff.slice(0, 19)) return ''
  return `这份配置在该版本之后修改过（${shortTime(updated)}），显示的是当前内容，可能与该版本当时运行的不同`
})
// ---- 配置联调（config_api.md）----
// 保存配置 → config/modify/updateConfig（带 configId = 更新）。
//
// 2026-08-28 面板减法（0828 §2.1 / D02 / §6.2）：
//   - 「另存为新配置」删除 → 由**复制节点**承担（右键菜单 / useDuplicateNode，走 config/copyAll）；
//   - 保存前的影响范围确认删除 → 直接落库，只在按钮旁留一行「N 个源在用」灰字；
//   - 换配置的入口在配置条上的「更换」（NodeConfigSelect.vue）。
const saving = ref(false)
const savingDeployment = ref(false)
const deploymentError = ref('')
watch(id, () => { deploymentError.value = '' })

async function updateDeployment(node: NodeConfig, nodeId: string) {
  savingDeployment.value = true
  deploymentError.value = ''
  try {
    const deployment = await syncNodeDeployment(node, nodeId)
    if (deployment) ElMessage.success('对应流程节点的部署配置已生成或更新')
  } catch (e) {
    const detail = (e as Error)?.message ?? String(e)
    if (cfg.value === node) deploymentError.value = detail
    ElMessage.warning(`节点配置已保存，但部署配置同步失败：${detail}；可再次点击保存重试`)
  } finally { savingDeployment.value = false }
}

function reportWriteError(action: string, e: unknown) {
  const message = (e as Error)?.message ?? String(e)
  ElMessage.error(`${action}失败：${message}`)
}

/** 取配置原始记录做基底：我们的模型没覆盖 clearRule/transRule/checkRule 等 BLOB，不带原值会被清空 */
async function baseRecordFor(currentId: string): Promise<Record<string, unknown>> {
  if (!currentId) return {}
  try {
    return (await configApi.configDetailRaw(currentId)) ?? {}
  } catch {
    return {}
  }
}

// 使用范围（0828 §6.2）：**不做保存前确认**——会上原话「正常保存就保存了，不要有提示」。
// 只在保存按钮旁挂一行灰字「N 个源在用」，独占（1 个源）时不显示。
// 取数时机：**节点置脏时查一次**，同一个 configId 不重复查；只读浏览不发请求
// （0824-11 §6.1 已说过每个节点都发 sourcePaged 太重）。
const sourceUsage = ref<Record<string, number>>({})
const usageCount = computed(() => (configId.value ? sourceUsage.value[configId.value] : undefined))
const usageNote = computed(() => (usageCount.value && usageCount.value > 1 ? `${usageCount.value} 个源在用` : ''))
async function ensureUsage(currentConfigId: string) {
  if (!currentConfigId || sourceUsage.value[currentConfigId] !== undefined) return
  try {
    const res = await sourceApi.sourcePaged({ configId: currentConfigId, page: 1, size: 1 })
    sourceUsage.value = { ...sourceUsage.value, [currentConfigId]: res.total }
  } catch {
    // 查不到就不显示，不打扰用户——这行字是提示不是门禁
  }
}
watch([nodeConfigDirty, configId], ([dirty, cid]) => {
  if (dirty && cid) void ensureUsage(cid)
}, { immediate: true })

function ensureConfigNameFromTitle(node = cfg.value, nodeId = id.value) {
  if (!node) return
  const name = node.configName?.trim() || node.title.trim()
  if (name && name !== node.configName) flow.setConfigName(nodeId, name)
}

async function onSaveNodeConfig() {
  const node = cfg.value
  if (!node || saving.value || savingDeployment.value) return
  const savedNodeId = id.value, savedTab = tab.value
  if (deploymentError.value && !nodeConfigDirty.value) {
    await updateDeployment(node, savedNodeId)
    await saveOtherNodes(savedNodeId)
    return
  }
  if (isRuleNode(node)) {
    const bindingError = validateTableBinding(
      node.ruleCfg ?? { inputTableId: '', inputFields: [], outputFields: [] },
      { requireOutput: !isMonitorNode(node) && !isDataValidationNode(node) },
    )
    if (bindingError) {
      flow.setActiveTab('table')
      ElMessage.warning(bindingError)
      return
    }
  }
  ensureConfigNameFromTitle()
  const saved = configId.value ? await doUpdateExistingConfig(node, id.value) : await doCreateConfig()
  // 数据监控节点在编排配置 Tab 点底部「保存」（2026-09-07 补）：配置保存成功后同步 ck_source
  //（vanv-data-engine /api/source/*，按 sourceId 无则 insert、有则 update）。与 RuleOrchestrationTab
  //「保存脚本」后的同步同一条逻辑（utils/flow/monitorCkSource.ts）；失败不回滚配置保存，单独提示。
  // 源一并传进去：节点没配过定时时，节点配置 Tab 展示的就是源上的 cron，落库要用同一个值。
  if (saved && tab.value === 'orchestration' && isMonitorNode(node)) {
    try {
      await syncMonitorCkSource(flow.sourceCfg?.sourceId, node, flow.sourceCfg)
    } catch (e) {
      ElMessage.error(`监控源配置同步失败：${(e as Error)?.message ?? String(e)}`)
    }
  }
  if (saved) await syncSourceCron(node, id.value)
  if (saved && savedTab === 'orchestration') await updateDeployment(node, savedNodeId)
  await saveOtherNodes(savedNodeId)
}

/**
 * 「保存」= 整张画布一起保存（0826 会上反馈：连加几个节点只点一次保存，只存进当前这个）。
 * 当前节点存完后，把画布上其余节点也处理掉：没有配置的新节点逐个建配置并绑定，已有配置但有改动的静默更新。
 * 存不了的（只读 / 规则节点表绑定未通过 / 共享配置未换绑等）不阻断其他节点，最后合并成一条提示。
 */
async function saveOtherNodes(currentId: string) {
  if (readonly.value || viewingHistory.value) return
  const skipped: string[] = []
  const unconfigured: { nodeId: string; title: string }[] = []
  let created = 0
  saving.value = true
  try {
    for (const nodeId of persistableNodeIds(flow.main, flow.branchGroups)) {
      if (nodeId === currentId || nodeId === 'start' || nodeId === 'end' || nodeId === '0' || isSyntheticRootId(nodeId)) continue
      const node = flow.configs[nodeId]
      if (!node) continue
      if (!node.configId) {
        // 已有步骤却没有配置（如新建空白流程的入口节点）：不替用户新建——旧平台要求先选配置才能提交，
        // 也无法判断是真没配置还是回读失败，新建会盖掉真配置。这里只提示并定位。
        if (isWritableStepId(nodeId)) {
          unconfigured.push({ nodeId, title: node.title })
          continue
        }
        if (isRuleNode(node) && validateTableBinding(
          node.ruleCfg ?? { inputTableId: '', inputFields: [], outputFields: [] },
          { requireOutput: !isMonitorNode(node) && !isDataValidationNode(node) },
        )) {
          skipped.push(node.title)
          continue
        }
        ensureConfigNameFromTitle(node, nodeId)
        if (await doCreateConfig(node, nodeId, { quiet: true })) created += 1
        else skipped.push(node.title)
      } else if (flow.dirtyConfigNodes.includes(nodeId)) {
        const before = autoSavedAt.value[nodeId]
        await autosaveNode(nodeId, '')
        if (flow.dirtyConfigNodes.includes(nodeId) && autoSavedAt.value[nodeId] === before) skipped.push(node.title)
      }
    }
  } finally {
    saving.value = false
  }
  if (created) ElMessage.success(`另有 ${created} 个新节点已一并建立配置并保存`)
  if (skipped.length) ElMessage.warning(`以下节点未能保存，请逐个检查：${skipped.join('、')}`)
  if (unconfigured.length) {
    ElMessage.warning(`以下节点尚未配置，请选择配置后保存：${unconfigured.map((n) => n.title).join('、')}`)
    flow.select(unconfigured[0].nodeId)
  }
}

/**
 * 定时策略写回 job 表（2026-09-18）。
 *
 * 定时**不在 config 上**，所以配置保存那一路带不动它：节点配置的载荷里压根没有 cron 字段
 * （`nodeConfigPayload` / `stepPersist` 都没有）。在这之前，界面上改了定时点保存是
 * **完全没有效果**的——刷新回来又是 job 表里的旧值。
 *
 * 与监控节点同 ck_source 的做法一致：配置保存成功后单独发一次，**失败不回滚配置保存**，
 * 只单独提示。
 *
 * 只在 cron **真的变了**时才发：保存节点配置是高频动作，没必要每次都往 job 表写一遍；
 * 而且没改却发一次，会把这条定时的下次运行时间重算，白白推迟一轮。
 */
async function syncSourceCron(node: NodeConfig, nodeId: string) {
  const sourceId = flow.sourceCfg?.sourceId
  if (!sourceId) return
  // 2026-10-15：定时不是必填（旧平台同口径）。只在用户这次手动改过定时策略时才同步；没碰定时的保存不建 / 不改定时，
  // 也不会在未发布的流程上弹「定时没保存」。原来默认展示的那条「每天 0:00」会被当成要建的定时，每次保存都去建。
  if (!flow.isScheduleEdited(nodeId)) return
  const next = nodeScheduleCron(node, flow.sourceCfg)
  const current = flow.sourceJob?.schedule ?? ''
  if (!next || next === current) {
    flow.clearScheduleEdited(nodeId)
    return
  }
  // 新建定时前先看流程有没有发布版本：后端只给已发布的流程建定时（新建出来的流程只有草稿 v1）。
  // 已有定时（有 jobId）走 updateJob 原地改，不受影响。
  const canvasFlow = canvasFlowIdOf(flow)
  if (!flow.sourceJob?.jobId && canvasFlow && flowVersion.flowId === canvasFlow && flowVersion.enabled && !flowVersion.overview?.publishId) {
    ElMessage({ type: 'warning', message: unpublishedFlowCronHint(canvasFlow, flowVersion.draft?.flowVer), duration: 8000, showClose: true })
    flow.clearScheduleEdited(nodeId)
    return
  }
  try {
    // 已有定时就原地改那一条（传 jobId 走 updateJob），不然 createJobs 会再建一条，
    // 两条定时同时启用、源被抓两遍。新建的默认启用——用户特地配了定时，就是要它跑。
    // configId 是后端必传参数；本客户端 query 序列化会跳过空串（client.ts appendQuery），
    // 必须给真实值——优先节点配置 ID，没有时退回源的主配置 ID。
    const ack = await sourceApi.saveSourceCron([sourceId], next, {
      jobId: flow.sourceJob?.jobId || undefined,
      enable: true,
      configId: node.configId || flow.sourceCfg?.configId || '',
    })
    if (!ack.ok) {
      ElMessage.warning(cronSaveErrorHint(ack.message || '') ?? `定时保存失败：${ack.message || '未知原因'}`)
      return
    }
    /**
     * 回查一次，把**真的 jobId** 拿回来（2026-09-22 修）。
     *
     * 原先这里只在本地造一份壳：源上首次配定时时 `flow.sourceJob` 是 null，
     * 于是塞了个 `jobId: ''` 的对象——界面立刻显示「已启用 / 运行 0 次」，
     * 可那条定时**没有 ID**，右上角开关一点就是 `setJobEnabled([''])`，
     * 必然回「没有可操作的定时任务」。用户 2026-09-22 报的「为什么关不上」就是它。
     *
     * 原注释担心"立刻回查拿到还没刷新的旧值"——那顾虑针对的是**启停**写的 `isDelete`
     * （见 sourceJobs 的说明），而 `jobId` 是新建完就有的，回查拿得到。
     * 万一真没查到（主从延迟之类），退回原来那份本地壳，行为不比从前差；
     * 此时开关会因为没有 jobId 而禁用（TaskScheduleSettings），不会再让人白点。
     */
    const fresh = await sourceApi.sourceJobs(sourceId).catch(() => [] as Awaited<ReturnType<typeof sourceApi.sourceJobs>>)
    const hit = fresh.find((j) => j.schedule === next && j.jobId)
      ?? fresh.find((j) => j.jobId && !j.disabled)
      ?? fresh.find((j) => j.jobId)
    flow.setSourceJob(hit ?? {
      ...(flow.sourceJob ?? {
        jobId: '', jobName: '', sourceId, nextRun: undefined, lastRun: undefined,
        runCount: 0, successCount: 0, disabled: false,
      }),
      schedule: next,
    })
    flow.clearScheduleEdited(nodeId)
    ElMessage.success(`定时已保存：${next}`)
  } catch (e) {
    const message = (e as Error)?.message ?? String(e)
    ElMessage({ type: 'error', message: cronSaveErrorHint(message) ?? `定时保存失败：${message}`, duration: 8000, showClose: true })
  }
}

/**
 * 新拉的节点第一次「保存」= 建一份**独立的新配置**并绑到本节点（开发计划 W0-3）。
 *
 * 走 `config/add`（config_api.md §十六）——这是后端唯一的"从零建配置"通路：
 *   · `updateConfig` 不带 configId **不会创建**（0828 实测：返回 success 但无 CONF_ADD 流水，
 *     当时据此误判成"后端没有建配置接口"，其实是敲错了门）；
 *   · `source/genConfig` 是源级批量（入参是源 ID 列表），给不了指定节点；
 *   · `snatch/snatchSave` 的 newConfig=1 必然连带建一个源。
 *
 * 与「更换」的区别要分清：更换是**绑到一份已有配置**，多个节点共用、改一处影响所有引用方；
 * 这里是新建一份只属于本节点的。
 */
async function doCreateConfig(
  node: NodeConfig | undefined = cfg.value,
  nodeId: string = id.value,
  opts: { quiet?: boolean } = {},
): Promise<boolean> {
  if (!node) return false
  // quiet（批量保存其余节点）：saving 已由调用方持有，成功提示由调用方汇总
  if (!opts.quiet && saving.value) return false
  if (!opts.quiet) saving.value = true
  try {
    const payload = buildConfigPayload(node)
    const created = await configApi.addConfig(payload)
    if (!created.ok || !created.configId) {
      ElMessage.error(`${opts.quiet ? `节点「${node.title}」：` : ''}${created.message || '新增配置失败'}`)
      return false
    }
    // 回查一次再绑：add 的回执只有 msg，拿不到落库后的完整记录（后端还会补 state/topic 等）。
    const saved = await configApi.configDetail(created.configId)
    if (!saved) {
      // 配置确实建出来了，只是没绑上。说清楚 ID，让用户能用「更换」找回来，
      // 不要假装成功——那会留下一份没人引用的孤儿配置，而且用户以为已经绑好了。
      ElMessage.warning(`配置 #${created.configId} 已新建，但回查详情失败、未能绑定到本节点，请用配置条上的「更换」选中它`)
      return false
    }
    flow.bindExistingConfig(nodeId, saved)
    flow.markNodeConfigSaved(nodeId)
    // 文案不能承诺没做到的事（0903）：这一步只落了**配置**，节点本身（item/next 步骤）由画布
    // 自动保存另外落库。步骤没落成的话，重进画布这个节点就不存在了——而用户已经看到"成功"。
    // 所以这里只说配置这一半，把"节点还在保存中"一并讲清楚，别让人以为万事大吉就走了。
    if (!opts.quiet) ElMessage.success(`配置 #${created.configId} 已新建并绑定；节点正在保存，请留意顶部保存状态`)
    return true
  } catch (e) {
    reportWriteError(opts.quiet ? `节点「${node.title}」新增配置` : '新增配置', e)
    return false
  } finally {
    if (!opts.quiet) saving.value = false
  }
}

/**
 * 更新已有配置。`auto`（1021-06 自动保存）：共享配置不弹确认、直接跳过（调用方已拦），成功不弹提示；
 * 同一配置的保存经 enqueueConfigSave 串行（并发校验不原子，186 实测）。
 */
async function doUpdateExistingConfig(node: NodeConfig, nodeId: string, opts: { auto?: boolean } = {}): Promise<boolean> {
  const currentConfigId = node.configId || ''
  if (!currentConfigId) return false
  if (!opts.auto && saving.value) return false
  // 0929 F2：复制时未换绑成功的共享配置——保存会改到模板/原流程，必须先知情确认。
  // saving 在确认前就置位：弹窗等待期间双击「保存」不会开第二个确认。
  if (!opts.auto) saving.value = true
  try {
    if (!opts.auto && !await assertConfigWritable(currentConfigId, flow.flowId)) return false
    return await enqueueConfigSave(currentConfigId, async () => {
      const base = await baseRecordFor(currentConfigId)
      const payload = { ...buildConfigPayload(node, base), configId: currentConfigId }
      const ack = await configApi.updateConfig(payload as never)
      if (ack && 'ok' in ack && !ack.ok) {
        ElMessage.error(`${opts.auto ? `节点「${node.title}」自动保存失败：` : ''}${ack.message || '保存配置失败'}`)
        return false
      }
      flow.markNodeConfigSaved(nodeId)
      // 本次保存后 updateDt 已变，不刷新的话下一次保存会被后端当成并发冲突拒掉。
      // 读的是自己刚写完的版本，和保存前现取 base 来冒充「加载时版本」不是一回事；
      // 同一配置的其他节点一并刷新。
      await refreshConfigUpdateDt(currentConfigId)
      if (opts.auto) autoSavedAt.value = { ...autoSavedAt.value, [nodeId]: clockNow() }
      else ElMessage.success(ack?.message || `配置 #${currentConfigId} 已保存`)
      return true
    })
  } catch (e) {
    // 过期 updateDt 后端回「当前配置已被修改，请刷新页面后重新操作」——自动保存不重试，原样提示，改动留着
    reportWriteError(opts.auto ? `节点「${node.title}」自动保存` : '保存配置', e)
    return false
  } finally {
    if (!opts.auto) saving.value = false
  }
}

// ---- 节点配置自动保存（1021-06，方案 §4.2 / §4.3）----
// 只在切换节点、切换节点面板页签、离开画布时保存；没改动不发（每次保存后端都记一条操作日志）。
// 不自动保存、留给用户点「保存」的：只读 / 看历史版本、还没有配置（第一次保存会新建配置）、
// 共享配置（要弹确认）、规则节点表绑定没通过。
const autoSavedAt = ref<Record<string, string>>({})
function clockNow(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function autoSaveBlocked(node: NodeConfig): boolean {
  if (readonly.value || viewingHistory.value || !node.configId) return true
  if (detachFailureFor(node.configId, flow.flowId)) return true
  if (isRuleNode(node)) {
    return !!validateTableBinding(
      node.ruleCfg ?? { inputTableId: '', inputFields: [], outputFields: [] },
      { requireOutput: !isMonitorNode(node) && !isDataValidationNode(node) },
    )
  }
  return false
}
async function autosaveNode(nodeId: string | undefined, atTab: string) {
  if (!nodeId || !flow.dirtyConfigNodes.includes(nodeId)) return
  const node = flow.configs[nodeId]
  if (!node || autoSaveBlocked(node)) return
  ensureConfigNameFromTitle(node, nodeId)
  const saved = await doUpdateExistingConfig(node, nodeId, { auto: true })
  if (!saved) return
  if (atTab === 'orchestration' && isMonitorNode(node)) {
    try {
      await syncMonitorCkSource(flow.sourceCfg?.sourceId, node, flow.sourceCfg)
    } catch (e) {
      ElMessage.error(`监控源配置同步失败：${(e as Error)?.message ?? String(e)}`)
    }
  }
  await syncSourceCron(node, nodeId)
}
/** 把所有能自动保存的脏节点存掉（切换编排对象前由画布页调用） */
async function flushDirtyNodes() {
  for (const nodeId of [...flow.dirtyConfigNodes]) await autosaveNode(nodeId, nodeId === id.value ? tab.value : '')
}
watch(() => flow.selectedId, (_next, prev) => { void autosaveNode(prev, tab.value) })
watch(() => flow.activeTab, (_next, prev) => { void autosaveNode(id.value, prev) })
const unregisterFlusher = registerNodeConfigFlusher(flushDirtyNodes)
// Ctrl / ⌘ + S：立即保存当前节点
function onSaveKey(event: KeyboardEvent) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
  if (!isActiveNodeConfigFlusher(flushDirtyNodes)) return
  event.preventDefault()
  if (cfg.value && !readonly.value && canSaveNodeConfig.value && !saving.value) void onSaveNodeConfig()
}
window.addEventListener('keydown', onSaveKey)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onSaveKey)
  unregisterFlusher()
  // 离开画布：能存的照存（不等结果，失败会弹提示）
  void flushDirtyNodes()
})

// 资产联动数据：主壳加载一次并 provide，各 tab 子组件通过 useNodeInspectorAssets 只读消费。
const assets = provideNodeInspectorAssets()
const isRule = computed(() => isRuleNode(cfg.value))

// 规则相关数据只在真的选中过规则节点时才拉，拉过一次后缓存，切别的规则节点不重复拉。
const rulesLoaded = ref(false)
function loadRuleAssets() {
  if (rulesLoaded.value) return
  rulesLoaded.value = true
  void Promise.allSettled([
    ruleApi.ruleGroups().then((r) => (assets.ruleGroups.value = r)),
    ruleApi.rulePaged({ size: 100 }).then((r) => (assets.rules.value = r.list)),
    ruleApi.sharedConfigs().then((r) => (assets.sharedCfgs.value = r)),
  ])
}
watch(isRule, (v) => { if (v) loadRuleAssets() })

const nodeInspectorSub = computed(() => {
  if (!cfg.value) return ''
  const typeLabel = nodeTypeLabel(cfg.value)
  if (cfg.value.sub === '规则处理 · group/page' && typeLabel && typeLabel !== '规则处理') {
    const seed = Object.values(NODE_CONFIGS).find((s) => s.title === typeLabel)
    if (seed?.sub) return seed.sub
    return `${typeLabel} · group/page`
  }
  return cfg.value.sub
})

onMounted(async () => {
  if (isRule.value) loadRuleAssets()
  await Promise.allSettled([
    entryApi.entryPaged({ size: 100 }).then((r) => (assets.tables.value = mergeEntryTypesPreservingFields(assets.tables.value, r.list))),
    paramApi.paramPaged({ size: 100 }).then((r) => (assets.params.value = r.list)),
  ])
})
</script>

<template>
  <div class="rc-inspector" :class="{ 'is-readonly': readonly }" :data-readonly="readonly ? 'true' : undefined">
    <template v-if="cfg">
      <div class="rc-insp-head">
        <div>
          <div class="rc-insp-title">{{ cfg.title }}</div>
          <div class="rc-insp-sub">{{ nodeInspectorSub }}</div>
        </div>
        <div class="rc-insp-head-right">
          <button
            class="rc-insp-expand"
            type="button"
            :title="ui.inspectorExpanded ? '还原配置区宽度' : '展开配置区，便于编辑表配置'"
            @click="ui.toggleInspectorExpanded()"
          >{{ ui.inspectorExpanded ? '⊟ 还原' : '⛶ 展开' }}</button>
          <!-- 收起整个配置区（Z3-2）：收起后变成右侧一条窄边，点它再展开。
               只有展开态能看到本按钮，收起态的入口在窄条本身。 -->
          <button
            class="rc-insp-expand"
            type="button"
            data-testid="inspector-collapse"
            title="收起配置区，把宽度让给左边"
            @click="ui.toggleInspectorCollapsed()"
          >» 收起</button>
          <!-- 节点启停开关（0710 会议 D5）：停用=数据流经此节点时跳过不处理；逐节点验证通过后全开再定时跑 -->
          <label class="ni-enable-switch" :class="{ 'ni-readonly': readonly }" :title="cfg.disabled ? '节点已停用：数据在此节点不处理，点击启用' : '节点运行中：点击停用（数据将跳过此节点）'">
            <input type="checkbox" :checked="!cfg.disabled" @change="flow.setNodeDisabled(id, !($event.target as HTMLInputElement).checked)" />
            <span>{{ cfg.disabled ? '已停用' : '启用中' }}</span>
          </label>
          <span class="rc-status" :class="statusClass">{{ statusText }}</span>
        </div>
      </div>

      <!-- 配置条（0824-00 §6.1 + 0828 §2.1-2b）：保持原来的静态展示，旁边加一个轻量「更换」入口。
           表单里不再另起一行「本节点使用配置」——那是同一份信息显示两遍。 -->
      <div class="rc-config-bar" :class="{ 'ni-readonly': readonly }">
        <span class="cb-label">当前配置</span>
        <span v-if="cfg?.configName" class="cb-name" :title="cfg.configName">{{ cfg.configName }}</span>
        <span v-if="configId" class="cb-id" :title="`配置 ID ${configId}`">#{{ configId }}</span>
        <span class="cb-origin" :class="{ fresh: !configId || isInitialSourceConfig }">{{ configOriginText }}</span>
        <NodeConfigSelect v-if="id" :node-id="id" />
      </div>
      <div v-if="historyConfigNote" class="ni-history-note" data-testid="history-config-note">{{ historyConfigNote }}</div>

      <!-- 0929 F2：复制时配置去共享失败的常驻提示——该节点配置仍与来源流程共享，保存前会再弹确认。 -->
      <div v-if="sharedConfigWarning" class="ni-output-warn" data-testid="shared-config-warn">
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="该节点配置仍与来源共享"
          :description="`配置 #${sharedConfigWarning.configId} 在复制流程时未能自动复制独立配置，目前仍与${sharedConfigWarning.sourceFlowRef}共享。修改它会同时影响该流程及所有使用它的源；保存前会再弹一次确认。`"
        />
      </div>

      <!-- 输出表未就绪的常驻提示；entry/95 文件下载同样需要选表。 -->
      <div v-if="inputMismatch" class="ni-output-warn" data-testid="input-table-mismatch">
        <el-alert type="info" :closable="false" show-icon title="输入表与上游输出表不一致" :description="`本节点输入表 ${inputMismatch.own}，上游输出表 ${inputMismatch.upstream}。上游插入、删除节点或改表时，本节点输入表不会自动跟随`" />
      </div>

      <div v-if="outputTableWarning" class="ni-output-warn" data-testid="output-table-warn">
        <el-alert type="warning" :closable="false" show-icon title="输出表未选择" :description="outputTableWarningText" />
      </div>

      <!-- 顶层 Tab：节点配置 / 表配置 / 编排配置 / 任务配置；普通画布可按需保留 AI 对话。 -->
      <div class="rc-top-tabs">
        <button
          v-for="t in TOP_TABS"
          :key="t[0]"
          type="button"
          class="rc-top-tab"
          :class="{ active: tab === t[0] }"
          :disabled="!!t[2]"
          :title="t[2]"
          @click="flow.setActiveTab(t[0])"
        >{{ t[1] }}</button>
      </div>

      <div class="rc-inspector-body">
        <NodeAiChat v-if="tab === 'ai'" :key="id" />
        <TaskTab v-else-if="tab === 'task'" />
        <TableTab v-else-if="tab === 'table'" />
        <RuleOrchestrationTab v-else-if="tab === 'orchestration'" />
        <ConfigTab v-else />
      </div>

      <!-- 节点配置脏状态条（0824-00 §5.4）：右侧只保留保存动作 -->
      <!-- AI 对话不产生配置改动，不挂保存条 -->
      <div v-if="tab !== 'ai'" class="rc-insp-foot">
        <span class="foot-note">
          <i v-if="nodeConfigDirty && !readonly" class="foot-dot" />{{ footNote }}
        </span>
        <!-- 使用范围提示（0828 §6.2）：不拦截、不弹框，只让用户在按下去之前知道这份配置是共用的 -->
        <span v-if="usageNote && !readonly" class="foot-usage" data-testid="config-usage-note">{{ usageNote }}</span>
        <!-- 只读（发布版 / 锁定草稿）不放保存按钮：禁用态的主按钮看着仍像能点（用户 10-10 反馈） -->
        <button
          v-if="!readonly"
          class="rc-btn primary"
          type="button"
          data-testid="node-config-save"
          :disabled="!canSaveNodeConfig || saving || savingDeployment"
          :title="configId ? (canSaveNodeConfig ? undefined : '当前没有需要保存的修改') : '保存后会新建一份配置并绑定到本节点'"
          @click="onSaveNodeConfig"
        >{{ saving || savingDeployment ? '保存中…' : '保存' }}</button>
      </div>
    </template>

    <template v-else>
      <div class="rc-insp-head">
        <div>
          <div class="rc-insp-title">未选择节点</div>
          <div class="rc-insp-sub">点击画布节点查看 / 编辑配置</div>
        </div>
      </div>
      <div class="rc-inspector-body">
        <div class="rc-help">当前画布为空或未选择节点。用画布中间的「智能推荐流程」起草链路，或点击连线上的「＋」手工添加步骤。</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.rc-inspector { background: #fff; border: 1px solid var(--rc-border); border-radius: var(--rc-radius); overflow: hidden; height: 100%; min-height: 0; display: flex; flex-direction: column; }
.rc-insp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 42px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); }
.ni-enable-switch { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--rc-text-2); cursor: pointer; white-space: nowrap; }
.ni-enable-switch input { cursor: pointer; }
.rc-insp-title { font-weight: 700; color: var(--rc-text); font-size: 13px; }
.rc-insp-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.rc-insp-head-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.rc-insp-expand { border: 1px solid #d5e2f2; background: #fff; color: var(--rc-text-2); border-radius: 6px; font-size: 11px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.rc-insp-expand:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-inspector-body { padding: 12px; overflow: auto; flex: 1 1 auto; min-height: 0; }
/* 只读：内容区不接收鼠标（不能改），滚动容器本身照常——滚轮 / 滚动条都落到 .rc-inspector-body 上 */
.rc-inspector.is-readonly .rc-inspector-body > * { pointer-events: none; }
.rc-inspector.is-readonly .ni-readonly { pointer-events: none; opacity: .6; }

/* 顶层 Tab：参数字段并入任务配置后，不再显示独立参数页签。 */
.rc-top-tabs { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--rc-border); border-radius: 9px; background: #f1f5f9; margin-bottom: 12px; }
.rc-top-tab { flex: 1; min-width: 0; border: 0; background: transparent; border-radius: 7px; padding: 7px 4px; color: var(--rc-muted); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-top-tab.active { background: #fff; color: var(--rc-primary-ink); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
.rc-top-tab:hover:not(.active):not(:disabled) { color: var(--rc-primary-ink); }
.rc-top-tab:disabled { color: var(--rc-faint); cursor: not-allowed; opacity: 0.6; }

.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }

/* 配置绑定条（0824-00 §6.1） */
.rc-config-bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fbfdff; }

/* 0927 H1：输出表未就绪警告条（与配置条同宽节奏，紧凑不喧宾） */
.ni-history-note { padding: 5px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fffbeb; color: #92400e; font-size: 11px; line-height: 1.5; }
.ni-output-warn { padding: 6px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fffcf5; }
.ni-output-warn .el-alert { padding: 6px 10px; }
.ni-output-warn .el-alert__title { font-size: 11px; line-height: 1.4; }
.ni-output-warn .el-alert__description { font-size: 10px; line-height: 1.5; margin-top: 2px; }
.cb-label { color: var(--rc-muted); font-size: 11px; white-space: nowrap; }
.cb-name { font-size: 11px; font-weight: 600; color: var(--rc-text); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-id { font-size: 11px; font-weight: 600; color: var(--rc-text); font-variant-numeric: tabular-nums; }
.cb-origin { font-size: 10px; color: var(--rc-primary-ink); background: var(--rc-primary-bg); border-radius: 4px; padding: 2px 6px; white-space: nowrap; }
.cb-origin.fresh { color: var(--rc-warn); background: #fff7ed; }

/* 节点配置脏状态条（0824-00 §5.4） */
.rc-insp-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--rc-border-soft); background: #fff; }
.foot-note { display: inline-flex; align-items: center; gap: 6px; flex: 1 1 auto; font-size: 11px; color: var(--rc-text-2); }
.foot-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--rc-warn); flex-shrink: 0; }
.foot-usage { font-size: 11px; color: var(--rc-faint); white-space: nowrap; }
</style>
