<script setup lang="ts">
// 建源表单里的「采集流程」摘要（1123 A1）：已选流程名、节点数、会写入的表。
// 让用户提交前就看到流程用哪些表，不用另建表；完整节点图 / 表配置由调用方的「预览 / 更换」打开。
import { ref, watch } from 'vue'
import { ElDialog, ElIcon } from 'element-plus'
import { Connection } from '@element-plus/icons-vue'
import { entryApi, flowCenterApi, type FlowRecord } from '@/api'
import FlowReadonlyPreview from './FlowReadonlyPreview.vue'

const props = defineProps<{
  /** 要展示的流程 / 模板 ID；空 = 暂不配置流程 */
  flowId: string
  /** 摘要前缀，如「复制自」「按模板」 */
  prefix?: string
  /** flowId 为空时的说明 */
  emptyText?: string
  /** 自带「预览节点及表配置」按钮：只读节点图 + 节点 / 表 / 任务配置（与「关联已有流程」同一套预览） */
  previewable?: boolean
  /**
   * inline：在摘要下方就地展开 / 收起（默认折叠），用于对话卡片这类不适合再弹窗的地方；
   * dialog（默认）：弹窗预览。
   */
  previewMode?: 'dialog' | 'inline'
}>()

const flowRecord = ref<FlowRecord | null>(null)
const previewOpen = ref(false)

const name = ref('')
const nodeCount = ref<number | null>(null)
const tables = ref<Array<{ id: string; label: string }>>([])
const loading = ref(false)
const error = ref('')
let seq = 0

function usable(id: string | null | undefined): id is string {
  return !!id && id !== '0' && id !== '-1'
}

watch(() => props.flowId, async (flowId) => {
  const req = ++seq
  name.value = ''
  flowRecord.value = null
  previewOpen.value = false
  nodeCount.value = null
  tables.value = []
  error.value = ''
  if (!flowId) return
  loading.value = true
  try {
    const [detail, steps] = await Promise.all([
      flowCenterApi.detail(flowId).catch(() => null),
      flowCenterApi.steps(flowId).catch(() => []),
    ])
    if (req !== seq) return
    name.value = detail?.name ?? ''
    flowRecord.value = detail
    nodeCount.value = steps.length
    const ids = [...new Set(steps.map(step => step.outputTable).filter(usable))]
    tables.value = ids.map(id => ({ id, label: id }))
    loading.value = false
    await Promise.all(ids.map(async (id, index) => {
      const entry = await entryApi.entryDetail(id).catch(() => null)
      if (req !== seq || !entry) return
      const cn = entry.name || ''
      const en = entry.tableName || ''
      tables.value[index] = { id, label: cn && en && cn !== en ? `${cn}（${en}）` : cn || en || id }
    }))
  } catch (reason) {
    if (req === seq) error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    if (req === seq) loading.value = false
  }
}, { immediate: true })
</script>

<template>
  <div class="fcs" data-testid="flow-choice-summary">
    <div v-if="!flowId" class="fcs-empty">{{ emptyText || '暂不配置流程：源建好后没有流程，进画布后在流程标签栏「＋」配置。' }}</div>
    <div v-else class="fcs-main">
      <span class="fcs-icon" aria-hidden="true"><ElIcon :size="16"><Connection /></ElIcon></span>
      <div class="fcs-body">
        <div class="fcs-head">
          <strong class="fcs-name" :title="name || `#${flowId}`">{{ name || `#${flowId}` }}</strong>
          <span class="fcs-actions">
            <button
              v-if="previewable"
              type="button"
              class="fcs-btn"
              :class="{ open: previewMode === 'inline' && previewOpen }"
              :disabled="!flowRecord"
              :aria-expanded="previewMode === 'inline' ? previewOpen : undefined"
              data-testid="flow-choice-preview"
              @click="previewOpen = !previewOpen"
            >{{ previewMode === 'inline' ? (previewOpen ? '收起节点及表配置' : '展开节点及表配置') : '预览节点及表配置' }}<span v-if="previewMode === 'inline'" class="fcs-caret">▾</span></button>
            <slot name="actions" />
          </span>
        </div>
        <div class="fcs-meta">
          <span v-if="prefix" class="fcs-prefix">{{ prefix }}</span>
          <span class="fcs-id">#{{ flowId }}</span>
          <span v-if="nodeCount !== null" class="fcs-count">{{ nodeCount }} 个节点</span>
        </div>
        <div v-if="loading" class="fcs-muted">正在读取流程节点…</div>
        <div v-else-if="error" class="fcs-error">流程读取失败：{{ error }}</div>
        <div v-else-if="tables.length" class="fcs-tables" data-testid="flow-choice-tables">
          <span class="fcs-label">写入表</span>
          <span v-for="t in tables" :key="t.id" class="fcs-table" :title="`表 ID ${t.id}`">{{ t.label }}</span>
        </div>
        <div v-else class="fcs-muted">暂无写入表：模板只定义了节点结构，建好后在画布里配表</div>
      </div>
    </div>
    <div v-if="previewable && previewMode === 'inline' && previewOpen && flowRecord" class="fcs-inline" data-testid="flow-choice-inline-preview">
      <FlowReadonlyPreview :flow="flowRecord" style="height: 100%" />
    </div>
    <ElDialog
      v-if="previewable && previewMode !== 'inline' && flowRecord"
      v-model="previewOpen"
      :title="`流程预览 · ${flowRecord.name}（#${flowRecord.id}）`"
      width="min(1280px, calc(100vw - 32px))"
      append-to-body
      data-testid="flow-choice-preview-dialog"
    >
      <FlowReadonlyPreview v-if="previewOpen" :flow="flowRecord" style="height: min(600px, calc(100vh - 210px))" />
    </ElDialog>
  </div>
</template>

<style scoped>
/* 与表单输入框同一视觉：白底、细边框、7px 圆角，看起来是「一个已选好的字段」 */
.fcs { padding: 10px 12px; border: 1px solid #dbe3ee; border-radius: 7px; background: #fff; font-size: 12px; color: var(--rc-text); }
.fcs-main { display: flex; align-items: flex-start; gap: 10px; }
.fcs-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.fcs-body { flex: 1; min-width: 0; }
.fcs-head { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.fcs-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 700; color: var(--rc-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fcs-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 2px; color: var(--rc-faint); font-size: 11px; }
.fcs-prefix { padding: 0 5px; border-radius: 4px; background: #f1f5f9; color: var(--rc-muted); line-height: 16px; }
.fcs-id { font-variant-numeric: tabular-nums; }
.fcs-count { padding: 0 6px; border-radius: 9px; background: #eef2ff; color: var(--rc-primary-ink); line-height: 16px; }
.fcs-actions { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.fcs-btn { height: 26px; padding: 0 10px; border: 1px solid #d5e2f2; border-radius: 6px; background: #fff; color: var(--rc-primary-ink); font-size: 12px; cursor: pointer; white-space: nowrap; }
.fcs-btn:hover:not(:disabled) { border-color: #93c5fd; background: var(--rc-primary-bg); }
.fcs-btn:disabled { opacity: .5; cursor: not-allowed; }
.fcs-caret { display: inline-block; margin-left: 4px; transition: transform .15s; }
.fcs-btn.open .fcs-caret { transform: rotate(180deg); }
/* 对话卡片里就地展开：高度封顶，不把对话撑太长；左右分栏沿用预览组件自身的可拖宽度 */
.fcs-inline { height: min(420px, 60vh); margin-top: 10px; border-top: 1px solid var(--rc-border); padding-top: 10px; }
.fcs-tables { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-top: 8px; }
.fcs-label { color: var(--rc-muted); font-size: 11px; }
.fcs-table { padding: 1px 7px; border-radius: 4px; background: #f1f5f9; color: var(--rc-text-2); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
.fcs-muted { margin-top: 8px; color: var(--rc-faint); font-size: 11px; }
.fcs-error { margin-top: 8px; color: var(--rc-error); font-size: 11px; }
.fcs-empty { color: var(--rc-muted); line-height: 1.6; }
</style>
