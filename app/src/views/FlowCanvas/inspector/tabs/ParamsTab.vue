<script setup lang="ts">
// 参数配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出）。
// 内容：URL 参数绑定（UrlParamEditor）+ 参数子源只读摘要 + 编辑入口（EditParamSourceDialog）。
// 行为与原内联实现 1:1；首采集节点展示参数子源摘要，其余采集节点展示各自的 UrlParamEditor。
import { computed, ref } from 'vue'
import { useFlowStore } from '@/stores/flow'
import { collectorCapabilityOf, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import UrlParamEditor from '../UrlParamEditor.vue'
import ParamSourceEditor, { type ParamSourceModel } from '@/views/FlowCanvas/source/ParamSourceEditor.vue'
import EditParamSourceDialog from '@/views/FlowCanvas/source/EditParamSourceDialog.vue'

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

// 参数源（0721 会议 T5）：源本身就是"多值组合展开成 N 个 URL"的语义，节点级「当前子源取值」单值下拉
// 跟这个语义冲突（选一个值没有意义），改成只读摘要（复用加源那套 ParamSourceEditor，readonly 态）
// + 编辑入口，真正编辑在源级弹窗里改，避免源级配置分散到节点上两处维护。
const isParamSource = computed(() => flow.sourceCfg?.kind === 'param')
const paramSourceModel = computed<ParamSourceModel>(() => ({
  baseUrl: flow.sourceCfg?.baseUrl ?? '',
  urlTemplate: flow.sourceCfg?.urlTemplate ?? '',
  refs: flow.sourceCfg?.paramRefs ?? [],
}))
const editParamSourceOpen = ref(false)

// 参数子源的 urlTemplate 只灌给主链首个采集节点（applyParamSourceUrlToFirstCollectNode），
// 其余节点该走各自的 UrlParamEditor；用 isFirstCollectorNode 区分两种展示。
const isFirstCollectorNode = computed(() => !!cc.value && flow.main.find((nodeId: string) => !!flow.configs[nodeId]?.collectCfg) === id.value)
</script>

<template>
  <!-- 参数配置独立于节点与任务配置：绑定全局参数，URL token 只标识参数插入位置。 -->
  <template v-if="cc && nodeCapability?.supportsUrlParams">
    <template v-if="isParamSource && isFirstCollectorNode">
      <ParamSourceEditor :model-value="paramSourceModel" readonly />
      <button class="rc-btn" type="button" style="margin-top: 8px" @click="editParamSourceOpen = true">编辑参数子源</button>
    </template>
    <template v-else>
      <!-- 参数子源的 urlTemplate 只灌给主链首个采集节点（applyParamSourceUrlToFirstCollectNode），
           其余节点该走各自的 UrlParamEditor；这里提示一下避免用户以为参数子源摘要该出现在这。 -->
      <div v-if="isParamSource" class="rc-readonly-hint" style="margin-bottom: 8px">
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
  </template>
  <div v-else class="rc-readonly-hint">当前节点不支持 URL 参数配置。</div>

  <EditParamSourceDialog v-model="editParamSourceOpen" />
</template>

<style scoped>
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
.rc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 11px; border: 1px solid #d5e2f2; border-radius: 7px; background: #fff; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.rc-btn:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
</style>
