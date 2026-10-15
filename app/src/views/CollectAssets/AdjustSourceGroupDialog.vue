<script setup lang="ts">
/**
 * 调整来源组弹窗（1008-04，§3.5）。源列表「选中来源 ▾ → 调整来源组」打开。
 *
 * 分两块：
 * 1. 勾选的源：显示数量和当前归属；勾选的源分属不同组时禁止操作（changeMembers 只接受一个 expected）；
 *    目标可选「退出来源组」或任一启用中的组。
 * 2. 按当前筛选范围：显示「当前筛选范围共 N 个源」和条件摘要；调 `changeMembersByRange`，
 *    范围参数与列表请求完全相同（外层把 `currentQuery()` 原样传进来，保证页面看到什么就改什么）。
 *    没有任何筛选条件时红色警告「将对全部可见来源调整归属」，二次确认后才带 `confirmAll=true`。
 *
 * 结果提示优先用后端 msg（例如「范围内共 120 个来源：加入 100、换组 15、已符合 5」）。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sourceGroupApi, type Source } from '@/api'
import { isProductionBackend } from '@/api/client'
import type { SourceFilter } from '@/views/FlowCanvas/result/useSourceLaunch'

const props = defineProps<{
  /** 勾选的源（空 = 没勾选，走「按当前筛选范围」） */
  selectedSources: Source[]
  /** 列表查询参数（currentQuery() 原样）；按范围调整时与列表同参 */
  query: SourceFilter
  /** 是否带着筛选条件（无 → 按范围调整要二次确认 confirmAll） */
  hasQueryFilter: boolean
  /** 条件摘要文案（describeFilters 的产物；无筛选条件时传空） */
  queryText: string
  /** 按范围调整不可用（「我的视图」目录范围：changeMembersByRange 不认 viewCategoryId，会变成不限） */
  rangeBlocked?: boolean
  /** 来源组候选（含停用组，停用的不可选为目标） */
  groups: { sourceGroupId: string; name: string; state: string }[]
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const mode = ref<'selected' | 'range'>('selected')
const target = ref('')
const saving = ref(false)
/** 生产写保护没放开 changeMembersByRange（一次能改上万个源，2026-10-10 定），连生产时只能按勾选调整 */
const rangeAllowed = !isProductionBackend() && !props.rangeBlocked
/** 退出来源组：两个接口口径不同——changeMembers 传 null，changeMembersByRange 传 -1 */
const LEAVE = '__none__'

watch(() => props.selectedSources, (sources) => {
  mode.value = !sources.length && rangeAllowed ? 'range' : 'selected'
}, { immediate: true })

/** 勾选源当前归属（changeMembers 的 expected 只接受一个值） */
const selectedGroups = computed(() => {
  const set = new Set<string>()
  for (const s of props.selectedSources) {
    if (s.sourceGroupId) set.add(s.sourceGroupId)
    else set.add('')
  }
  return [...set]
})
/** 勾选的源分属不同组（含「未归组」也算一种）→ 禁止操作 */
const selectedMixed = computed(() => selectedGroups.value.length > 1)
const canSubmitSelected = computed(() => mode.value === 'selected' && !!target.value && !selectedMixed.value && props.selectedSources.length > 0)
const canSubmitRange = computed(() => mode.value === 'range' && !!target.value)

/** 按范围调整的确认：没有任何筛选条件时，红色警告 + 二次确认（confirmAll=true） */
async function submit() {
  if (saving.value) return
  if (!target.value) {
    ElMessage.warning('请选择目标组（或「退出来源组」）')
    return
  }
  saving.value = true
  try {
    if (mode.value === 'selected') {
      // 勾选的源：按当前归属 changeMembers（expected 只接受一个，分属不同组时前端已禁止）
      const group = selectedGroups.value[0]
      await sourceGroupApi.changeMembers({
        sourceIds: props.selectedSources.map((s) => s.sourceId),
        sourceGroupId: target.value === LEAVE ? null : target.value,
        expectedSourceGroupId: group === undefined || group === '' ? null : group,
      })
      ElMessage.success(`已调整 ${props.selectedSources.length} 个来源的归属`)
    } else {
      // 按当前筛选范围：没有任何筛选条件时，红色警告 + 二次确认（confirmAll=true）
      if (!props.hasQueryFilter) {
        try {
          await ElMessageBox.confirm(
            '当前没有任何筛选条件，将对全部可见来源调整归属（超过 2 万个后端会拒绝）。确定继续？',
            '确认对全部来源调整',
            { type: 'warning', confirmButtonText: '确定调整', cancelButtonText: '取消' },
          )
        } catch {
          return
        }
      }
      // 只在不带筛选条件（用户已二次确认）时带 confirmAll=true；有筛选条件就不带
      const result = await sourceGroupApi.changeMembersByRange({
        filter: props.query,
        targetSourceGroupId: target.value === LEAVE ? '-1' : target.value,
        ...(props.hasQueryFilter ? {} : { confirmAll: true }),
      })
      const r = result as { total?: number; joined?: number; moved?: number; left?: number; unchanged?: number }
      ElMessage.success(`范围内共 ${r.total ?? 0} 个来源：加入 ${r.joined ?? 0}、换组 ${r.moved ?? 0}、退组 ${r.left ?? 0}、已符合 ${r.unchanged ?? 0}`)
    }
    emit('saved')
    emit('close')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="true" title="调整来源组" width="520px" style="max-width: calc(100vw - 32px)" append-to-body @close="emit('close')">
    <el-radio-group v-model="mode" class="asg-mode">
      <el-radio :value="'selected'" :disabled="!selectedSources.length">勾选的源（{{ selectedSources.length }}）</el-radio>
      <el-radio :value="'range'" :disabled="!rangeAllowed" :title="rangeAllowed ? '' : rangeBlocked ? '「我的视图」目录里只能按勾选调整' : '生产环境暂不支持按筛选范围批量调整'">按当前筛选范围</el-radio>
    </el-radio-group>

    <!-- 勾选的源 -->
    <div v-if="mode === 'selected'" class="asg-block">
      <p v-if="!selectedSources.length" class="asg-summary" data-testid="asg-need-selection">请先在列表中勾选来源。生产环境暂不支持按筛选范围批量调整。</p>
      <p v-else class="asg-summary">已勾选 <strong>{{ selectedSources.length }}</strong> 个来源。{{ selectedMixed ? '勾选的源分属不同来源组，请分别处理（一次只能调整到同一目标）。' : '目标可选「退出来源组」或任一启用中的组。' }}</p>
    </div>

    <!-- 按当前筛选范围 -->
    <div v-else class="asg-block">
      <p class="asg-summary">按当前筛选范围调整归属（条件摘要见下方）。</p>
      <p class="asg-filter-text">{{ queryText || '无筛选条件' }}</p>
      <el-alert
        v-if="!hasQueryFilter"
        title="当前没有任何筛选条件，将对全部可见来源调整归属（超过 2 万个后端会拒绝）。提交时需要二次确认。"
        type="error"
        :closable="false"
      />
    </div>

    <div class="asg-block">
      <label class="asg-label">目标</label>
      <el-select v-model="target" placeholder="选择目标组或退出来源组" style="width: 100%" data-testid="asg-target">
        <el-option :value="LEAVE" label="退出来源组" />
        <el-option v-for="g in groups" :key="g.sourceGroupId" :value="g.sourceGroupId" :label="g.name" :disabled="g.state !== 'ACTIVE'" />
      </el-select>
    </div>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :disabled="mode === 'selected' ? !canSubmitSelected : !canSubmitRange" :loading="saving" data-testid="asg-submit" @click="submit">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.asg-mode { margin-bottom: 8px; }
.asg-block { margin-bottom: 12px; }
.asg-summary { font-size: 13px; color: var(--rc-text); margin: 0 0 4px; }
.asg-filter-text { font-size: 12px; color: var(--rc-muted); background: #f8fafc; border: 1px solid var(--rc-border-soft); border-radius: 6px; padding: 6px 8px; margin: 4px 0 8px; }
.asg-label { display: block; font-size: 12px; color: var(--rc-text-2); margin-bottom: 4px; }
</style>
