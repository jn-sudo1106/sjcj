<script setup lang="ts">
// 流程版本状态（2026-10-10；10-11 改成紧凑徽标，见模板注释）：217 起全部流程进版本模式，v1 已发布（运行中的版本不能直接改）。
// 2026-10-11 定：不用先点「编辑草稿」，在画布上直接改，第一次保存时自动生成草稿 Vn+1（stores/flowVersion.ts），
// 一直是这个草稿直到「发布」变成发布 Vn+1，或「放弃草稿」。发布 / 放弃的确认文案对齐旧平台 FlowNodeDrawer；
// 锁定（只读）沿用旧平台的锁，前端只展示；手工运行 / 切换版本 / 归档本期不做。
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { canvasFlowIdOf, useFlowVersionStore } from '@/stores/flowVersion'
import { reloadFlowIntoCanvas, reloadSourceIntoCanvas } from '@/utils/flow/applyTemplateToSource'
import { useFlowAutosave } from './useFlowAutosave'

const flow = useFlowStore()
const version = useFlowVersionStore()
const { flush, status } = useFlowAutosave()
const busy = ref(false)

const canvasFlowId = computed(() => canvasFlowIdOf(flow))
const visible = computed(() => version.enabled && !!canvasFlowId.value && version.flowId === canvasFlowId.value)
/** 悬停说明：原来常驻在版本条里的一句话，挪到这里省一整行 */
const tip = computed(() => {
  const cur = version.overview?.curVer ?? '—'
  const d = version.draft
  // 新建的流程只有草稿 v1、还没有发布版（2026-10-12 实测）
  if (d && version.overview?.curVer == null) return `草稿 v${d.flowVer}：这条流程还没有发布版本，发布后才会被任务使用。`
  if (!d) return `当前运行版本 v${cur}。直接修改即可，第一次保存时自动生成草稿 v${version.overview?.nextVer ?? '—'}，发布后新任务才会使用。`
  if (d.isLock === 1) return `草稿 v${d.flowVer} 已锁定，节点只能查看；请到旧平台解锁后再修改。当前运行的仍是 v${cur}。`
  return `修改只保存在草稿 v${d.flowVer} 里，当前运行的仍是 v${cur}；发布后新任务使用 v${d.flowVer}，已启动的任务继续用原版本。`
})

async function reloadCanvas() {
  const sourceId = flow.sourceCtx?.sourceId
  const ok = sourceId ? await reloadSourceIntoCanvas(sourceId) : await reloadFlowIntoCanvas(canvasFlowId.value)
  if (!ok) ElMessage.warning('画布重新加载失败，请刷新页面查看')
}

/** 发布 / 放弃前先把画布上还没写完的改动落进草稿，否则发布出去的不是用户看到的样子 */
async function settle(): Promise<boolean> {
  await flush()
  if (flow.dirty || status.value === 'error' || status.value === 'pending') {
    ElMessage.warning('画布还有未保存成功的改动，请先处理头部的保存提示，再发布或放弃')
    return false
  }
  return true
}

async function onPublish() {
  const d = version.draft
  if (!d || busy.value || !await settle()) return
  const changedBase = d.baseId !== version.overview?.publishId
  try {
    await ElMessageBox.confirm(
      changedBase ? '当前发布版本已与草稿基线不同，发布会覆盖当前定义。' : '发布后，新任务使用此版本，已启动任务继续使用原版本。',
      `发布草稿 v${d.flowVer}？`,
      { confirmButtonText: '发布', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    await version.publish()
    ElMessage.success(`已发布 v${d.flowVer}，新任务将使用该版本`)
    await reloadCanvas()
  } catch (e) {
    ElMessage.error(`发布失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    busy.value = false
  }
}

async function onAbandon() {
  const d = version.draft
  if (!d || busy.value) return
  try {
    await ElMessageBox.confirm(
      '放弃后草稿里的修改全部丢弃，画布恢复为当前发布版本；不占用发布版本号。尚未完成的草稿任务可能因版本失效而失败。',
      `放弃草稿 v${d.flowVer}？`,
      { confirmButtonText: '放弃草稿', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    await flush()
    await version.abandon()
    ElMessage.success('草稿已放弃，已恢复为当前发布版本')
    await reloadCanvas()
  } catch (e) {
    ElMessage.error(`放弃草稿失败：${(e as Error)?.message ?? String(e)}`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- 紧凑版本状态（2026-10-11：不再单独占一行，嵌在源画布流程标签栏 / 流程中心抽屉标题行里；说明放悬停提示） -->
  <span v-if="visible" class="fvs" :class="{ draft: !!version.draft }" data-testid="flow-version-bar">
    <el-tooltip :content="tip" placement="bottom" :show-after="200">
      <span v-if="version.draft" class="fvs-tag draft" data-testid="flow-version-draft">草稿 v{{ version.draft.flowVer }} · 未发布</span>
      <span v-else class="fvs-tag" data-testid="flow-version-published">已发布 v{{ version.overview?.curVer ?? '—' }}</span>
    </el-tooltip>
    <span v-if="version.draft?.isLock === 1" class="fvs-tag locked" data-testid="flow-version-locked">已锁定</span>
    <!-- 查看历史版本时不给放弃 / 发布（2026-10-14），避免对着历史版本点发布 -->
    <template v-if="version.draft && !version.history">
      <button class="fvs-btn" type="button" :disabled="busy" data-testid="flow-version-abandon" @click="onAbandon">放弃</button>
      <button class="fvs-btn publish" type="button" :disabled="busy" data-testid="flow-version-publish" @click="onPublish">发布 v{{ version.draft.flowVer }}</button>
    </template>
  </span>
</template>

<style scoped>
.fvs { display: inline-flex; flex: none; align-items: center; gap: 5px; align-self: center; margin-left: 7px; white-space: nowrap; }
.fvs-tag { padding: 1px 6px; border-radius: 4px; background: #e2e8f0; color: #475569; font-size: 11px; line-height: 18px; cursor: default; }
.fvs-tag.draft { background: #fef3c7; color: #92400e; }
.fvs-tag.locked { background: #fee2e2; color: #b91c1c; }
.fvs-btn { height: 24px; padding: 0 8px; border: 1px solid #93c5fd; border-radius: 6px; background: #eff6ff; color: #1d4ed8; font-size: 11px; cursor: pointer; }
.fvs-btn.publish { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.fvs-btn:disabled { opacity: .55; cursor: not-allowed; }
</style>
