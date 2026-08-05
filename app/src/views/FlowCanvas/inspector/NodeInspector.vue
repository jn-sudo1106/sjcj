<script setup lang="ts">
// NodeInspector 主壳（P1-1 Step 4 · 拆 tab 子组件后的瘦壳）。
// 职责：① 加载并提供资产（tables/params/ruleGroups/rules/sharedCfgs）；
//       ② 顶层 Tab 切换；③ 节点头（标题/启停/展开）。各 Tab 的字段级逻辑在 tabs/*.vue 里。
// 规则资产的懒加载逻辑必须留主壳：NodeInspector 只 mount 一次（index.vue 没给 :key），
// isRule 会随选中节点变化，不能只在 onMounted 判断一次——否则打开画布时没选中规则节点就永远拉不到规则数据
// （见 NodeInspector.test.ts「规则数据懒加载」）。
import { computed, onMounted, ref, watch } from 'vue'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { isRuleNode, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import { nodeInspectorTabs } from './nodeInspectorTabs'
import { entryApi, paramApi, ruleApi } from '@/api'
import { provideNodeInspectorAssets } from './useNodeInspectorAssets'
import NodeAiChat from './NodeAiChat.vue'
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
    entryApi.entryPaged({ size: 100 }).then((r) => (assets.tables.value = r.list)),
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
.rc-top-tab { flex: 1; border: 0; background: transparent; border-radius: 7px; padding: 7px 4px; color: var(--rc-muted); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-top-tab.active { background: #fff; color: var(--rc-primary-ink); box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08); }
.rc-top-tab:hover:not(.active):not(:disabled) { color: var(--rc-primary-ink); }
.rc-top-tab:disabled { color: var(--rc-faint); cursor: not-allowed; opacity: 0.6; }

.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
</style>
