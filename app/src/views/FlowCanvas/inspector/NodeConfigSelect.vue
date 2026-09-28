<script setup lang="ts">
// 「更换配置」（0828 §2.1-2b，D01 撤回后保留的配置选择能力）。
//
// 迁自旧平台步骤表单的「本步骤使用配置」（旧 `SourceStep.vue:92` + `page/base/ConfigSelect.vue`），
// 数据源同样是 `configs/same`（按源查同资源配置）。
//
// 形态（2026-08-28 定）：**配置条保持原来的静态样式**（当前配置 test2 #1400917 已有配置），
// 只在旁边加一个轻量的「更换」入口——试过把整条换成 el-select，一个整框输入把这行压成了表单区，
// 比原来的静态文字重得多。选择本身走弹窗，弹窗里有搜索和候选详情。
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi, type Config } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { useSourceStore } from '@/stores/source'
import SelectExistingConfigDialog from './SelectExistingConfigDialog.vue'

const props = defineProps<{ nodeId: string }>()

const flow = useFlowStore()
const sourceStore = useSourceStore()
const cfg = computed(() => flow.configs[props.nodeId])
const sourceId = computed(() => flow.sourceCtx?.sourceId)
const binding = ref(false)
const pickerOpen = ref(false)

// 0927 G1：流程入口（isRoot=1 真实根行，画布第一个节点）的配置可换——后端 ROOT 权威方案下
// 首任务配置就是 ROOT.CONFIG_ID，新流程是「未配置草稿」，不在这里选配置就永远无法调度。
// 普通节点仍要源上下文才能按源查同资源配置（非源画布禁用）；ROOT 节点走 ROOT 专属通道
// （persistFlowSteps 的 updateRootConfig），候选配置不受源限制（后端 ROOT 可挂任意有效配置）。
// 0927 P1-8：只认**真实物化 ROOT 行**（stepId 是数字）——svg 查询在未回填 ROOT 环境回退的
// 「虚拟根」（itemConfig=0 / stepId='0'，isRoot=1 同样成立）与真实根无法靠 isRoot 区分，
// 对虚拟根放行会让 rootConfigUpdate('0', …) 把虚拟根物化成真根。
const isRootNode = computed(() => {
  const snap = sourceStore.stepSnapshots[props.nodeId]
  return snap?.isRoot === true && (snap.stepId ?? '') !== '0'
})
const canPick = computed(() => Boolean(sourceId.value) || (flow.flowIdMode && isRootNode.value))

/**
 * 绑定配置。**必须先取 configDetail 再绑**：`configs/same` 返回的是精简对象，
 * 直接喂给 applyConfigToNode 会把 entryTypeId/topic 这些字段写成空值（它是 `x || ''` 的写法）。
 * 详情读不到就不绑——宁可不绑，也不能绑上一份被抹空的配置。
 */
async function bind(configId: string) {
  if (!configId || configId === cfg.value?.configId || binding.value) return
  binding.value = true
  try {
    const detail = await configApi.configDetail(configId)
    if (!detail) {
      ElMessage.error(`配置 #${configId} 详情读取失败，未绑定`)
      return
    }
    flow.bindExistingConfig(props.nodeId, detail)
    ElMessage.success(isRootNode.value ? `已更新流程入口（ROOT）配置 #${configId}` : `已绑定配置 #${configId}`)
  } catch (e) {
    ElMessage.error(`绑定配置失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    binding.value = false
  }
}
function onPick(config: Config) {
  void bind(config.configId)
}
</script>

<template>
  <span class="ncs">
    <button
      class="ncs-btn"
      type="button"
      :disabled="binding || !canPick"
      data-testid="node-config-select"
      :title="isRootNode && !sourceId
        ? '更换流程入口（ROOT）配置'
        : sourceId
          ? '更换本节点使用的配置'
          : '当前不是源画布，无法按源查同资源配置'"
      @click="pickerOpen = true"
    >{{ binding ? '绑定中…' : '更换' }}</button>
    <SelectExistingConfigDialog
      v-model:open="pickerOpen"
      :source-id="isRootNode ? undefined : sourceId"
      :current-config-id="cfg?.configId || undefined"
      @select="onPick"
    />
  </span>
</template>

<style scoped>
.ncs { display: inline-flex; align-items: center; }
.ncs-btn { border: 1px solid #d5e2f2; background: #fff; color: var(--rc-text-2); border-radius: 6px; font-size: 11px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.ncs-btn:hover:not(:disabled) { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ncs-btn:disabled { color: var(--rc-faint); border-color: var(--rc-border-soft); cursor: not-allowed; }
</style>
