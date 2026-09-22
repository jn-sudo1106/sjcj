<script setup lang="ts">
// NodeInspector 主壳（P1-1 Step 4 · 拆 tab 子组件后的瘦壳）。
// 职责：① 加载并提供资产（tables/params/ruleGroups/rules/sharedCfgs）；
//       ② 顶层 Tab 切换；③ 节点头（标题/启停/展开）。各 Tab 的字段级逻辑在 tabs/*.vue 里。
// 规则资产的懒加载逻辑必须留主壳：NodeInspector 只 mount 一次（index.vue 没给 :key），
// isRule 会随选中节点变化，不能只在 onMounted 判断一次——否则打开画布时没选中规则节点就永远拉不到规则数据
// （见 NodeInspector.test.ts「规则数据懒加载」）。
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { decisionOrParallelKind, isDataValidationNode, isMonitorNode, isRuleNode, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { nodeInspectorTabs } from './nodeInspectorTabs'
import { configApi, entryApi, paramApi, ruleApi, sourceApi } from '@/api'
import { provideNodeInspectorAssets } from './useNodeInspectorAssets'
import { mergeEntryTypesPreservingFields } from '@/composables/useEntryTableFieldsCache'
import { buildConfigPayload } from '@/utils/flow/nodeConfigPayload'
import { syncMonitorCkSource } from '@/utils/flow/monitorCkSource'
import { nodeScheduleCron } from '@/utils/flow/scheduleCron'
import { validateTableBinding } from '@/utils/flow/ruleOrchestration'
import NodeAiChat from './NodeAiChat.vue'
import NodeConfigSelect from './NodeConfigSelect.vue'
import TaskTab from './tabs/TaskTab.vue'
import TableTab from './tabs/TableTab.vue'
import ParamsTab from './tabs/ParamsTab.vue'
import ConfigTab from './tabs/ConfigTab.vue'
import RuleOrchestrationTab from './tabs/RuleOrchestrationTab.vue'

const props = withDefaults(defineProps<{ hideAi?: boolean }>(), { hideAi: false })
const flow = useFlowStore()
const ui = useUiStore()
const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const tab = computed<string>(() => flow.activeTab)

const statusText = computed(() => (cfg.value?.disabled ? '已停止' : (cfg.value?.status ?? '')))
const statusClass = computed(() => (cfg.value?.disabled || cfg.value?.planned ? 'warn' : 'ok'))

// 顶层 Tab：非决策/分头节点统一走 config/table/[params]/orchestration/task/ai 这套（0804 拍板 + 0805 改判）；
// 参数配置只在非规则节点出现（0805 推翻 D17：采集节点的 URL 参数绑定离不开这个入口）；
// 决策/分头节点不产表也不需要编排/任务/AI，只显示「分支配置」一个 Tab 承载 BranchEditor。
const TOP_TABS = computed(() => nodeInspectorTabs(cfg.value, { includeAi: !props.hideAi }))
watch(() => props.hideAi, (hideAi) => {
  if (hideAi && flow.activeTab === 'ai') flow.setActiveTab('config')
}, { immediate: true })
watch(() => flow.selectedId, () => {
  const current = TOP_TABS.value.find((t) => t[0] === flow.activeTab)
  if (!current?.[2]) return
  const fallback = TOP_TABS.value.find((t) => !t[2])
  if (fallback) flow.setActiveTab(fallback[0])
})

// 配置绑定条（0824-00 §6.1）：一个 FlowNode 必须且只能引用一个 Config。
// 本期只落骨架——configId 来自迁移回填（flowModel.ts NodeConfig.configId），
// 配置名称/使用节点数/状态要等 config/configDetail 与使用范围接口（0824-07 §5），拿不到就不渲染，不填占位 0。
// 决策/分头节点只有「分支配置」，不参与配置绑定。
const isBranchNode = computed(() => !!cfg.value && decisionOrParallelKind(cfg.value) !== undefined)
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

// 双层脏状态（0824-00 §5.4）：本条只管当前节点的配置表单；流程脏标在画布 Header。
const nodeConfigDirty = computed(() => flow.dirtyConfigNodes.includes(id.value))
// 底部条常驻（不只在脏时出现）：新加的节点默认「新建配置」态，一个字段没改也要能保存一次拿 configId
// （0824-00 §5.3）；脏标只影响文案和按钮可用性。
// 配置名称跟节点名走（新增/复制时已写上），不再在节点配置 Tab 里填；保存时若仍为空就用节点名补上。
// 配置身份（新建 / 已有）由上面的配置绑定条表达，这里只说"有没有未提交的修改"，不重复也不夸大落库状态。
const canSaveNodeConfig = computed(() => nodeConfigDirty.value || !configId.value)
const footNote = computed(() => (nodeConfigDirty.value ? '节点配置有未保存修改' : '无未保存修改'))
// ---- 配置联调（config_api.md）----
// 保存配置 → config/modify/updateConfig（带 configId = 更新）。
//
// 2026-08-28 面板减法（0828 §2.1 / D02 / §6.2）：
//   - 「另存为新配置」删除 → 由**复制节点**承担（右键菜单 / useDuplicateNode，走 config/copyAll）；
//   - 保存前的影响范围确认删除 → 直接落库，只在按钮旁留一行「N 个源在用」灰字；
//   - 换配置的入口在配置条上的「更换」（NodeConfigSelect.vue）。
const saving = ref(false)

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

function ensureConfigNameFromTitle() {
  const node = cfg.value
  if (!node) return
  const name = node.configName?.trim() || node.title.trim()
  if (name && name !== node.configName) flow.setConfigName(id.value, name)
}

async function onSaveNodeConfig() {
  const node = cfg.value
  if (!node || saving.value) return
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
  const saved = configId.value ? await doUpdateExistingConfig() : await doCreateConfig()
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
  if (saved) await syncSourceCron(node)
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
async function syncSourceCron(node: NodeConfig) {
  const sourceId = flow.sourceCfg?.sourceId
  if (!sourceId) return
  const next = nodeScheduleCron(node, flow.sourceCfg)
  const current = flow.sourceJob?.schedule ?? ''
  if (!next || next === current) return
  try {
    // 已有定时就原地改那一条（传 jobId 走 updateJob），不然 createJobs 会再建一条，
    // 两条定时同时启用、源被抓两遍。新建的默认启用——用户特地配了定时，就是要它跑。
    // configId 是后端必传参数；本客户端 query 序列化会跳过空串（client.ts appendQuery），
    // 必须给真实值——优先节点配置 ID，没有时退回源的主配置 ID。
    const ack = await sourceApi.saveSourceCron([sourceId], next, {
      jobId: flow.sourceJob?.jobId || undefined,
      enable: true,
      configId: configId.value || flow.sourceCfg?.configId || '',
    })
    if (!ack.ok) {
      ElMessage.warning(`定时保存失败：${ack.message || '未知原因'}`)
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
    ElMessage.success(`定时已保存：${next}`)
  } catch (e) {
    ElMessage.error(`定时保存失败：${(e as Error)?.message ?? String(e)}`)
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
async function doCreateConfig(): Promise<boolean> {
  const node = cfg.value
  if (!node || saving.value) return false
  saving.value = true
  try {
    const payload = buildConfigPayload(node)
    const created = await configApi.addConfig(payload)
    if (!created.ok || !created.configId) {
      ElMessage.error(created.message || '新增配置失败')
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
    flow.bindExistingConfig(id.value, saved)
    flow.markNodeConfigSaved(id.value)
    // 文案不能承诺没做到的事（0903）：这一步只落了**配置**，节点本身（item/next 步骤）由画布
    // 自动保存另外落库。步骤没落成的话，重进画布这个节点就不存在了——而用户已经看到"成功"。
    // 所以这里只说配置这一半，把"节点还在保存中"一并讲清楚，别让人以为万事大吉就走了。
    ElMessage.success(`配置 #${created.configId} 已新建并绑定；节点正在保存，请留意顶部保存状态`)
    return true
  } catch (e) {
    reportWriteError('新增配置', e)
    return false
  } finally {
    saving.value = false
  }
}

async function doUpdateExistingConfig(): Promise<boolean> {
  const node = cfg.value
  if (!node || saving.value) return false
  saving.value = true
  try {
    const base = await baseRecordFor(configId.value)
    const payload = { ...buildConfigPayload(node, base), configId: configId.value }
    const ack = await configApi.updateConfig(payload as never)
    if (ack && 'ok' in ack && !ack.ok) {
      ElMessage.error(ack.message || '保存配置失败')
      return false
    }
    flow.markNodeConfigSaved(id.value)
    ElMessage.success(ack?.message || `配置 #${configId.value} 已保存`)
    return true
  } catch (e) {
    reportWriteError('保存配置', e)
    return false
  } finally {
    saving.value = false
  }
}

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

onMounted(async () => {
  if (isRule.value) loadRuleAssets()
  await Promise.allSettled([
    entryApi.entryPaged({ size: 100 }).then((r) => (assets.tables.value = mergeEntryTypesPreservingFields(assets.tables.value, r.list))),
    paramApi.paramPaged({ size: 100 }).then((r) => (assets.params.value = r.list)),
  ])
})
</script>

<template>
  <div class="rc-inspector">
    <template v-if="cfg">
      <div class="rc-insp-head">
        <div>
          <div class="rc-insp-title">{{ cfg.title }}</div>
          <div class="rc-insp-sub">{{ cfg.sub }}</div>
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
          <label class="ni-enable-switch" :title="cfg.disabled ? '节点已停用：数据在此节点不处理，点击启用' : '节点运行中：点击停用（数据将跳过此节点）'">
            <input type="checkbox" :checked="!cfg.disabled" @change="flow.setNodeDisabled(id, !($event.target as HTMLInputElement).checked)" />
            <span>{{ cfg.disabled ? '已停用' : '启用中' }}</span>
          </label>
          <span class="rc-status" :class="statusClass">{{ statusText }}</span>
        </div>
      </div>

      <!-- 配置条（0824-00 §6.1 + 0828 §2.1-2b）：保持原来的静态展示，旁边加一个轻量「更换」入口。
           表单里不再另起一行「本节点使用配置」——那是同一份信息显示两遍。 -->
      <div v-if="!isBranchNode" class="rc-config-bar">
        <span class="cb-label">当前配置</span>
        <span v-if="cfg?.configName" class="cb-name" :title="cfg.configName">{{ cfg.configName }}</span>
        <span v-if="configId" class="cb-id" :title="`配置 ID ${configId}`">#{{ configId }}</span>
        <span class="cb-origin" :class="{ fresh: !configId || isInitialSourceConfig }">{{ configOriginText }}</span>
        <NodeConfigSelect v-if="id" :node-id="id" />
      </div>

      <!-- 顶层 Tab：节点配置 / 表配置 / [参数配置] / 编排配置 / 任务配置；普通画布可按需保留 AI 对话。 -->
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
        <ParamsTab v-else-if="tab === 'params'" />
        <ConfigTab v-else />
      </div>

      <!-- 节点配置脏状态条（0824-00 §5.4）：右侧只保留保存动作 -->
      <!-- AI 对话不产生配置改动，不挂保存条 -->
      <div v-if="!isBranchNode && tab !== 'ai'" class="rc-insp-foot">
        <span class="foot-note">
          <i v-if="nodeConfigDirty" class="foot-dot" />{{ footNote }}
        </span>
        <!-- 使用范围提示（0828 §6.2）：不拦截、不弹框，只让用户在按下去之前知道这份配置是共用的 -->
        <span v-if="usageNote" class="foot-usage" data-testid="config-usage-note">{{ usageNote }}</span>
        <button
          class="rc-btn primary"
          type="button"
          :disabled="!canSaveNodeConfig || saving"
          :title="configId ? (nodeConfigDirty ? undefined : '当前没有需要保存的修改') : '保存后会新建一份配置并绑定到本节点'"
          @click="onSaveNodeConfig"
        >{{ saving ? '保存中…' : '保存' }}</button>
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

/* 顶层 Tab（0706 调整4 · 0707 微调 · 0804 统一为 config/table/orchestration/task/ai · 0805 参数配置回归非规则节点） */
.rc-top-tabs { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--rc-border); border-radius: 9px; background: #f1f5f9; margin-bottom: 12px; }
.rc-top-tab { flex: 1; min-width: 0; border: 0; background: transparent; border-radius: 7px; padding: 7px 4px; color: var(--rc-muted); font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-top-tab.active { background: #fff; color: var(--rc-primary-ink); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
.rc-top-tab:hover:not(.active):not(:disabled) { color: var(--rc-primary-ink); }
.rc-top-tab:disabled { color: var(--rc-faint); cursor: not-allowed; opacity: 0.6; }

.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }

/* 配置绑定条（0824-00 §6.1） */
.rc-config-bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fbfdff; }
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
