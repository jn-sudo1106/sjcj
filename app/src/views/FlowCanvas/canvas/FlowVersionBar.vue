<script setup lang="ts">
// 流程版本条（2026-10-10）：217 起全部流程进版本模式，v1 已发布只读。画布上的修改首次写入时自动生成
// 草稿（stores/flowVersion.ts），这里常驻说明「改的是草稿、发布后正式运行才用」，并提供发布 / 放弃。
// 对齐 217 旧平台 FlowNodeDrawer 的同名按钮与确认文案；锁定 / 手工运行 / 切换版本 / 归档本期不做。
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useFlowVersionStore } from '@/stores/flowVersion'
import { validFlowIdOf } from '@/utils/flow/stepPersist'
import { reloadFlowIntoCanvas, reloadSourceIntoCanvas } from '@/utils/flow/applyTemplateToSource'
import { useFlowAutosave } from './useFlowAutosave'

const flow = useFlowStore()
const version = useFlowVersionStore()
const { flush, status } = useFlowAutosave()
const busy = ref(false)

/** 画布当前流程（与 useStepWrite.flowIdOf 同口径） */
const canvasFlowId = computed(() => (flow.flowIdMode
  ? validFlowIdOf(flow.flowId)
  : validFlowIdOf(flow.sourceCfg?.flowId) || validFlowIdOf(flow.sourceCtx?.flowId)))
const visible = computed(() => version.enabled && !!canvasFlowId.value && version.flowId === canvasFlowId.value)

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
      `发布草稿 V${d.flowVer}？`,
      { confirmButtonText: '发布', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    await version.publish()
    ElMessage.success(`已发布 V${d.flowVer}，新任务将使用该版本`)
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
      `放弃草稿 V${d.flowVer}？`,
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
  <div v-if="visible" class="fvb" :class="{ draft: !!version.draft }" data-testid="flow-version-bar">
    <template v-if="version.draft">
      <span class="fvb-tag draft" data-testid="flow-version-draft">草稿 V{{ version.draft.flowVer }} · 未发布</span>
      <span class="fvb-text">修改只保存在草稿里，发布后新任务才会使用；当前运行的是 V{{ version.overview?.curVer ?? '—' }}。</span>
      <span class="fvb-actions">
        <button class="rc-btn tiny" type="button" :disabled="busy" data-testid="flow-version-abandon" @click="onAbandon">放弃草稿</button>
        <button class="rc-btn tiny primary" type="button" :disabled="busy" data-testid="flow-version-publish" @click="onPublish">发布 V{{ version.draft.flowVer }}</button>
      </span>
    </template>
    <template v-else>
      <span class="fvb-tag" data-testid="flow-version-published">当前发布 V{{ version.overview?.curVer ?? '—' }}</span>
      <span class="fvb-text">发布版本只读；在画布上修改会自动生成草稿，发布后新任务才会使用。</span>
    </template>
  </div>
</template>

<style scoped>
.fvb { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 12px 0; padding: 6px 10px; border: 1px solid var(--rc-border); border-radius: 6px; background: #f8fafc; color: var(--rc-muted); font-size: 12px; }
.fvb.draft { border-color: #fed7aa; background: #fff7ed; color: #9a3412; }
.fvb-tag { flex: none; padding: 1px 8px; border-radius: 999px; background: var(--rc-ok-bg); color: var(--rc-ok); font-weight: 600; }
.fvb-tag.draft { background: #ffedd5; color: #c2410c; }
.fvb-text { flex: 1; min-width: 200px; }
.fvb-actions { display: flex; gap: 6px; margin-left: auto; }
</style>
