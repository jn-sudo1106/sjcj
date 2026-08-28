<script setup lang="ts">
// 参数配置 Tab（P1-1 Step 4 · 从 NodeInspector.vue 拆出；0802 重构：参数源编辑入口挪到 ConfigTab 源 URL 区）。
// 内容：URL 参数绑定（UrlParamEditor）+ 提示"参数源请到节点配置"。摘要+跳转都搬到 ConfigTab，本 Tab 不再重复。
import { computed, watch } from 'vue'
import { useFlowStore } from '@/stores/flow'
import { collectorCapabilityOf, fieldOptionsFromTableOrOutput, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import UrlParamEditor from '../UrlParamEditor.vue'
import { useNodeInspectorAssets } from '../useNodeInspectorAssets'

const flow = useFlowStore()
const { tables, ensureTableFields } = useNodeInspectorAssets()

const cfg = computed<NodeConfig | undefined>(() => flow.selectedNode)
const id = computed<string>(() => flow.selectedId)
const cc = computed(() => cfg.value?.collectCfg)

const nodeCapability = computed(() => (cfg.value ? collectorCapabilityOf(cfg.value) : undefined))

// 出参列（旧 outContext）：2026-08-27 拍板从任务配置搬到这里。
// 取值来源是**输出表**字段（旧平台 SourceStep.vue 的「出参列」绑的就是 :type="form.outEntry"），
// 此前挂在任务配置里、且可用性判断错挂在「有没有输入表」上——搬过来一并改为按输出表判断。
const nodeTableId = computed(() => cc.value?.outputTable || cfg.value?.outputTable || '')
watch(nodeTableId, (tid) => ensureTableFields(tid), { immediate: true })
const outputTableFields = computed(() =>
  fieldOptionsFromTableOrOutput(nodeTableId.value, tables.value, cfg.value?.output))
const outColumns = computed<string[]>(() => cfg.value?.taskCfg?.outColumns ?? [])
const canAddOutColumn = computed(() => outputTableFields.value.some((f) => !outColumns.value.includes(f.prop)))

function onOutColumnChange(index: number, e: Event) {
  const next = [...outColumns.value]
  next[index] = (e.target as HTMLSelectElement).value
  flow.patchTaskConfig(id.value, { outColumns: next })
}
function addOutColumn() {
  const next = outputTableFields.value.find((f) => !outColumns.value.includes(f.prop))
  if (next) flow.patchTaskConfig(id.value, { outColumns: [...outColumns.value, next.prop] })
}
function removeOutColumn(index: number) {
  flow.patchTaskConfig(id.value, { outColumns: outColumns.value.filter((_, i) => i !== index) })
}

// URL 参数：节点绑定关系与源级取值覆盖分开保存。
function onUrlParamRefsChange(refs: string[]) {
  flow.patchCollect(id.value, { urlParamRefs: refs })
}
function onUrlParamValuesChange(values: Record<string, string>) {
  flow.patchCollect(id.value, { urlParamValues: values })
}

// 参数源：编辑入口在 ConfigTab 源 URL 区（0802 重构）；本 Tab 仅在非首节点 + 是参数源时给一行提示
const isParamSource = computed(() => flow.sourceCfg?.kind === 'param')
const isFirstCollectorNode = computed(() => !!cc.value && flow.main.find((nodeId: string) => !!flow.configs[nodeId]?.collectCfg) === id.value)
</script>

<template>
  <!-- 参数配置独立于节点与任务配置：绑定全局参数，URL token 只标识参数插入位置。 -->
  <template v-if="cc && nodeCapability?.supportsUrlParams">
    <!-- 非首节点 + 是参数源：提示「参数源编辑请到节点配置」，避免用户以为这里能编辑参数源 -->
    <div v-if="isParamSource && !isFirstCollectorNode" class="rc-readonly-hint" style="margin-bottom: 8px">
      本源为参数源，URL 模板在首个采集节点生效；本节点的 URL 参数按下方单独配置。
    </div>
    <UrlParamEditor
      :url="cc.url"
      :config-id="cfg?.configId"
      :param-refs="cc.urlParamRefs ?? []"
      :param-values="cc.urlParamValues ?? {}"
      :warn-fragment="nodeCapability?.kind === 'web'"
      @update:param-refs="onUrlParamRefsChange"
      @update:param-values="onUrlParamValuesChange"
    />
  </template>
  <div v-else class="rc-readonly-hint">当前节点不支持 URL 参数配置。</div>

  <!-- 出参列独立于 URL 参数：不支持 URL 参数的节点（如规则/清洗）一样要能配出参列，所以放在上面分支之外 -->
  <div class="rc-field pt-outcols"><label>出参列</label>
    <div v-if="outColumns.length" class="pt-field-list">
      <div v-for="(fieldId, index) in outColumns" :key="`${fieldId}-${index}`" class="pt-field-row">
        <select class="rc-select" :value="fieldId" @change="onOutColumnChange(index, $event)">
          <option v-for="f in outputTableFields" :key="f.prop" :value="f.prop">{{ f.prop }} · {{ f.desc }}</option>
        </select>
        <button class="rc-row-del" type="button" title="删除字段" @click="removeOutColumn(index)">×</button>
      </div>
    </div>
    <button class="rc-btn" type="button" :disabled="!canAddOutColumn" @click="addOutColumn">+ 添加字段</button>
    <div class="rc-help">
      {{ outputTableFields.length ? '添加当前节点输出表中需要保留给后续步骤的字段。' : '当前节点没有输出表，无法配置出参列。' }}
    </div>
  </div>
</template>

<style scoped>
.rc-readonly-hint { padding: 7px 9px; border: 1px dashed #dbe3ee; border-radius: 7px; background: #f8fafc; color: var(--rc-faint); font-size: 12px; }
.rc-field { display: block; min-width: 0; margin-bottom: 10px; }
.rc-field label { display: block; color: var(--rc-muted); font-size: 11px; margin-bottom: 4px; }
.pt-outcols { margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--rc-border-soft); }
.rc-select { width: 100%; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; color: var(--rc-text); font-size: 12px; padding: 7px 9px; outline: none; }
.rc-select:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px #dbeafe; }
.rc-btn { border: 1px solid #dbe3ee; background: #fff; color: var(--rc-text-2); border-radius: 7px; font-size: 12px; padding: 6px 10px; cursor: pointer; }
.rc-btn:hover:not(:disabled) { border-color: var(--rc-primary); color: var(--rc-primary-ink); }
.rc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rc-help { color: var(--rc-faint); font-size: 10px; line-height: 1.5; margin-top: 6px; }
.pt-field-list { display: grid; gap: 6px; margin-bottom: 6px; }
.pt-field-row { display: grid; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; gap: 6px; }
.rc-row-del { width: 20px; height: 20px; border: 0; background: transparent; color: var(--rc-faint); font-size: 12px; cursor: pointer; border-radius: 4px; }
.rc-row-del:hover { background: var(--rc-error-bg); color: #b91c1c; }
</style>
