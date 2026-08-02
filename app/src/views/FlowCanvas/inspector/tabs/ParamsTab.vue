<script setup lang="ts">
// 参数配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出；0802 重构：参数子源编辑入口挪到 ConfigTab 源 URL 区）。
// 内容：URL 参数绑定（UrlParamEditor）+ 提示"参数子源请到节点配置"。摘要+跳转都搬到 ConfigTab，本 Tab 不再重复。
import { computed } from 'vue'
import { useFlowStore } from '@/stores/flow'
import { collectorCapabilityOf, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import UrlParamEditor from '../UrlParamEditor.vue'

const flow = useFlowStore()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)

const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))

// URL 参数：节点绑定关系与子源级取值覆盖分开保存。
function onUrlParamRefsChange(refs: string[]) {
  flow.patchCollect(id.value, { urlParamRefs: refs })
}
function onUrlParamValuesChange(values: Record<string, string>) {
  flow.patchCollect(id.value, { urlParamValues: values })
}

// 参数子源：编辑入口在 ConfigTab 源 URL 区（0802 重构）；本 Tab 仅在非首节点 + 是参数源时给一行提示
const isParamSource = computed(() => flow.sourceCfg?.kind === 'param')
const isFirstCollectorNode = computed(() => !!cc.value && flow.main.find((nodeId: string) => !!flow.configs[nodeId]?.collectCfg) === id.value)
</script>

<template>
  <!-- 参数配置独立于节点与任务配置：绑定全局参数，URL token 只标识参数插入位置。 -->
  <template v-if="cc && nodeCapability?.supportsUrlParams">
    <!-- 非首节点 + 是参数源：提示「参数子源编辑请到节点配置」，避免用户以为这里能编辑参数子源 -->
    <div v-if="isParamSource && !isFirstCollectorNode" class="rc-readonly-hint" style="margin-bottom: 8px">
      本源为参数子源，URL 模板在首个采集节点生效；本节点的 URL 参数按下方单独配置。
    </div>
    <UrlParamEditor
      :url="cc.url"
      :param-refs="cc.urlParamRefs ?? []"
      :param-values="cc.urlParamValues ?? {}"
      :warn-fragment="nodeCapability?.kind === 'web'"
      @update:param-refs="onUrlParamRefsChange"
      @update:param-values="onUrlParamValuesChange"
    />
  </template>
  <div v-else class="rc-readonly-hint">当前节点不支持 URL 参数配置。</div>
</template>

<style scoped>
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
</style>
