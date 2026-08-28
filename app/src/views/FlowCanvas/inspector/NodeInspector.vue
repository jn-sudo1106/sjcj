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
import { decisionOrParallelKind, isRuleNode, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { nodeInspectorTabs } from './nodeInspectorTabs'
import { configApi, entryApi, paramApi, ruleApi, type Config } from '@/api'
import { provideNodeInspectorAssets } from './useNodeInspectorAssets'
import { mergeEntryTypesPreservingFields } from '@/composables/useEntryTableFieldsCache'
import { buildConfigPayload } from '@/utils/flow/nodeConfigPayload'
import NodeAiChat from './NodeAiChat.vue'
import SelectExistingConfigDialog from './SelectExistingConfigDialog.vue'
import SaveSharedConfigDialog from './SaveSharedConfigDialog.vue'
import SaveAsNewConfigDialog from './SaveAsNewConfigDialog.vue'
import TaskTab from './tabs/TaskTab.vue'
import TableTab from './tabs/TableTab.vue'
import ParamsTab from './tabs/ParamsTab.vue'
import ConfigTab from './tabs/ConfigTab.vue'
import RuleOrchestrationTab from './tabs/RuleOrchestrationTab.vue'

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
const TOP_TABS = computed(() => nodeInspectorTabs(cfg.value))

// 配置绑定条（0824-00 §6.1）：一个 FlowNode 必须且只能引用一个 Config。
// 本期只落骨架——configId 来自迁移回填（flowModel.ts NodeConfig.configId），
// 配置名称/使用节点数/状态要等 config/configDetail 与使用范围接口（0824-07 §5），拿不到就不渲染，不填占位 0。
// 决策/分头节点只有「分支配置」，不参与配置绑定。
const isBranchNode = computed(() => !!cfg.value && decisionOrParallelKind(cfg.value) !== undefined)
const configId = computed(() => cfg.value?.configId || '')

// 双层脏状态（0824-00 §5.4）：本条只管当前节点的配置表单；流程脏标在画布 Header。
const nodeConfigDirty = computed(() => flow.dirtyConfigNodes.includes(id.value))
// 底部条常驻（不只在脏时出现）：新加的节点默认「新建配置」态，一个字段没改也要能保存一次拿 configId
// （0824-00 §5.3）；脏标只影响文案和按钮可用性。
// 配置名称必填（0824-06 §4）。校验只在**保存那一刻**做：面板上不打星号、不常驻红字提示，
// 按钮也不因此禁用——点了保存才提示（2026-08-28 拍板，整个面板统一这个口径）。
// 字段只在采集节点的「节点配置」Tab 上，没有该字段的节点不设门槛，
// 否则规则/数据处理节点会被一个填不了的必填项永久挡住保存。
const configNameMissing = computed(() => !!cfg.value?.collectCfg && !cfg.value?.configName)
// 配置身份（新建 / 已有）由上面的配置绑定条表达，这里只说"有没有未提交的修改"，不重复也不夸大落库状态。
const canSaveNodeConfig = computed(() => nodeConfigDirty.value || !configId.value)
const footNote = computed(() => (nodeConfigDirty.value ? '节点配置有未保存修改' : '无未保存修改'))
// ---- 配置联调（config_api.md）----
// 保存配置 → config/modify/updateConfig（带 configId = 更新）
// 另存为新配置 → config/copyAll 复制 + 改名（updateConfig 不带 configId 并不会创建配置，实测）。
const selectConfigOpen = ref(false)
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

// 更新已有配置前先过影响范围确认（0824-00 §2.2）：配置可被多个源复用，这一次保存会写到所有用到它的源。
// 新建（还没有 configId）没有影响面，直接建。
const saveSharedOpen = ref(false)
async function onSaveNodeConfig() {
  const node = cfg.value
  if (!node || saving.value) return
  if (configNameMissing.value) {
    ElMessage.warning('请先填写配置名称')
    return
  }
  if (configId.value) {
    saveSharedOpen.value = true
    return
  }
  // 没有 configId 的节点没法保存：`updateConfig` 不带 configId 不会创建配置（实测），
  // 而 copyAll 需要一个可复制的源配置。这种节点要先「选择已有配置」再改，或等后端补新建端点（§6-2）。
  ElMessage.warning('本节点还没有绑定配置，请先「选择已有配置」；新建配置暂无可用接口')
}

async function doUpdateExistingConfig() {
  const node = cfg.value
  if (!node || saving.value) return
  saving.value = true
  try {
    const base = await baseRecordFor(configId.value)
    const payload = { ...buildConfigPayload(node, base), configId: configId.value }
    const ack = await configApi.updateConfig(payload as never)
    if (ack && 'ok' in ack && !ack.ok) {
      ElMessage.error(ack.message || '保存配置失败')
      return
    }
    flow.markNodeConfigSaved(id.value)
    ElMessage.success(ack?.message || `配置 #${configId.value} 已保存`)
  } catch (e) {
    reportWriteError('保存配置', e)
  } finally {
    saving.value = false
  }
}

/**
 * 另存为新配置 = 复制 + 改名 + 写入当前表单值（2026-08-28 拍板走这条）。
 * `updateConfig` 不带 configId 并不会创建配置（实测），只能沿用旧平台的 copyAll。
 * copyAll 的额外好处：它是后端整条复制，未建模的 BLOB（snatchConf 等）天然带走，比自己拼 payload 保真。
 */
async function copyConfigAsNew(node: NodeConfig, newName: string) {
  const from = configId.value
  const fromName = node.configName ?? ''
  const copied = await configApi.copyConfigAndLocate(from, fromName)
  if (!copied.ok) {
    ElMessage.error(copied.message || '复制配置失败')
    return
  }
  const newId = copied.configId
  // 先绑定再写内容：绑定是关键一步——只要绑上了，后续保存就打在新配置上，
  // 不会再污染原配置。内容写失败可以重试保存，绑定失败则会一直误伤原件。
  const base = (await configApi.configDetailRaw(newId)) ?? {}
  const payload = { ...buildConfigPayload(node, base), configId: newId, configName: newName }
  const ack = await configApi.updateConfig(payload)
  const detail = await configApi.configDetail(newId)
  if (detail) flow.bindExistingConfig(id.value, detail)
  if (ack && 'ok' in ack && !ack.ok) {
    ElMessage.warning(`已复制为配置 #${newId}（暂名「${copied.name}」）并绑定到本节点，但内容写入失败，请重新点「保存配置」`)
    return
  }
  ElMessage.success(`已另存为配置 #${newId}「${newName}」并绑定到本节点，记得保存流程`)
}

// 另存为新配置：先要一个唯一的新名字（弹窗里查重），再创建。
// 名字唯一是回查新 configId 的前提，见 SaveAsNewConfigDialog 顶部注释。
const saveAsNewOpen = ref(false)
function onSaveAsNewConfig() {
  if (saving.value) return
  saveAsNewOpen.value = true
}
async function doSaveAsNewConfig(newName: string) {
  const node = cfg.value
  if (!node || saving.value) return
  if (!configId.value) {
    // 没有原配置就无从复制。节点还没绑过配置时不该出现这个入口，这里只是兜底。
    ElMessage.warning('当前节点还没有绑定配置，无法另存')
    return
  }
  saving.value = true
  try {
    await copyConfigAsNew(node, newName)
  } catch (e) {
    reportWriteError('另存为新配置', e)
  } finally {
    saving.value = false
  }
}

function onSelectExistingConfig(config: Config) {
  flow.bindExistingConfig(id.value, config)
  ElMessage.success(`已绑定配置 #${config.configId}，记得保存流程`)
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
          <!-- 节点启停开关（0710 会议 D5）：停用=数据流经此节点时跳过不处理；逐节点验证通过后全开再定时跑 -->
          <label class="ni-enable-switch" :title="cfg.disabled ? '节点已停用：数据在此节点不处理，点击启用' : '节点运行中：点击停用（数据将跳过此节点）'">
            <input type="checkbox" :checked="!cfg.disabled" @change="flow.setNodeDisabled(id, !($event.target as HTMLInputElement).checked)" />
            <span>{{ cfg.disabled ? '已停用' : '启用中' }}</span>
          </label>
          <span class="rc-status" :class="statusClass">{{ statusText }}</span>
        </div>
      </div>

      <!-- 配置绑定条（0824-00 §6.1）：当前节点引用的 Config 身份 + 换绑入口 -->
      <div v-if="!isBranchNode" class="rc-config-bar">
        <span class="cb-label">当前配置</span>
        <span v-if="cfg?.configName" class="cb-name" :title="cfg.configName">{{ cfg.configName }}</span>
        <span v-if="configId" class="cb-id" :title="`配置 ID ${configId}`">#{{ configId }}</span>
        <span class="cb-origin" :class="{ fresh: !configId }">{{ configId ? '已有配置' : '新建配置 · 未保存' }}</span>
        <span class="cb-gap" />
        <button
          class="cb-act"
          type="button"
          :disabled="!flow.sourceCtx"
          :title="flow.sourceCtx ? '按本源查同资源配置，只改本节点的配置引用' : '当前不是源画布，无法按源查同资源配置'"
          @click="selectConfigOpen = true"
        >选择已有配置</button>
        <button
          class="cb-act"
          type="button"
          :disabled="saving"
          title="用当前表单值另建一份配置，只给本节点用，不动原配置"
          @click="onSaveAsNewConfig"
        >另存为新配置</button>
      </div>

      <!-- 顶层 Tab：节点配置 / 表配置 / [参数配置] / 编排配置 / 任务配置 / AI 对话；保持在视口里不被滚动条挤出 -->
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
        <button
          class="rc-btn primary"
          type="button"
          :disabled="!canSaveNodeConfig || saving"
          :title="nodeConfigDirty ? undefined : (configId ? '当前没有需要保存的修改' : '新建配置还没有配置 ID，保存后随「保存流程」一起提交')"
          @click="onSaveNodeConfig"
        >{{ saving ? '保存中…' : '保存配置' }}</button>
      </div>
      <SaveSharedConfigDialog
        v-model:open="saveSharedOpen"
        :config-id="configId"
        :config-name="cfg?.configName"
        @confirm="doUpdateExistingConfig"
        @save-as-new="onSaveAsNewConfig"
      />
      <SaveAsNewConfigDialog
        v-model:open="saveAsNewOpen"
        :source-name="cfg?.configName"
        :source-config-id="configId || undefined"
        @confirm="doSaveAsNewConfig"
      />
      <SelectExistingConfigDialog
        v-model:open="selectConfigOpen"
        :source-id="flow.sourceCtx?.sourceId"
        :current-config-id="configId || undefined"
        @select="onSelectExistingConfig"
      />
    </template>

    <template v-else>
      <div class="rc-insp-head">
        <div>
          <div class="rc-insp-title">未选择节点</div>
          <div class="rc-insp-sub">点击画布节点查看 / 编辑配置</div>
        </div>
      </div>
      <div class="rc-inspector-body">
        <div class="rc-help">当前画布为空或未选择节点。用画布中间的「智能推荐模板」起草链路，或点击连线上的「＋」手工添加步骤。</div>
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
.cb-gap { flex: 1 1 auto; }
.cb-act { border: 1px solid #d5e2f2; background: #fff; color: var(--rc-text-2); border-radius: 6px; font-size: 11px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.cb-act:disabled { color: var(--rc-faint); border-color: var(--rc-border-soft); cursor: not-allowed; }

/* 节点配置脏状态条（0824-00 §5.4） */
.rc-insp-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--rc-border-soft); background: #fff; }
.foot-note { display: inline-flex; align-items: center; gap: 6px; flex: 1 1 auto; font-size: 11px; color: var(--rc-text-2); }
.foot-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--rc-warn); flex-shrink: 0; }
</style>
