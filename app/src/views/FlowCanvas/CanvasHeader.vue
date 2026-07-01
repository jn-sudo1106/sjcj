<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { sourceApi } from '../../api'

const flow = useFlowStore()
const route = useRoute()
const router = useRouter()

const src = computed(() => flow.sourceCtx)
const view = computed(() => (route.query.view === 'data' ? 'data' : 'flow'))

const statusMeta = computed(() => {
  const s = src.value
  if (!s) return { cls: 'muted', text: '' }
  if (s.disabled) return { cls: 'muted', text: '已停用' }
  if (s.state === 'C') return { cls: 'ok', text: '成功' }
  if (s.state === 'E') return { cls: 'err', text: '出错' }
  if (s.state === 'L') return { cls: 'run', text: '运行中' }
  return { cls: 'muted', text: '未知' }
})
const metaLine = computed(() => {
  const s = src.value
  if (!s) return ''
  return [s.sourceId, s.category, s.cycle, s.owner ? `负责人 ${s.owner}` : '', s.lastSuccessAt ? `上次成功 ${s.lastSuccessAt}` : '']
    .filter(Boolean)
    .join(' · ')
})

function backToList() {
  router.push('/collect')
}
function switchView(target: 'flow' | 'data') {
  if (view.value === target) return
  const query = { ...route.query }
  if (target === 'data') query.view = 'data'
  else delete query.view
  router.push({ path: '/canvas', query })
}
async function srcSnatch() {
  const s = src.value
  if (!s) return
  const res = await sourceApi.sendSnatch([s.sourceId])
  ElMessage.success(res?.message || '已发起抓取（演示）')
}
async function srcCopy() {
  const s = src.value
  if (!s) return
  const res = await sourceApi.copySource(s.sourceId)
  ElMessage.success(res?.message || '已复制派生（演示）')
}
async function srcToggle() {
  const s = src.value
  if (!s) return
  const willDisable = !s.disabled
  try {
    await ElMessageBox.confirm(
      `确认${willDisable ? '停用' : '启用'}源「${s.name}」？`,
      willDisable ? '停用源' : '启用源',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const res = await sourceApi.changeSourceEnable(s.sourceId, willDisable)
  ElMessage.success(res?.message || `已${willDisable ? '停用' : '启用'}（演示）`)
  s.disabled = willDisable
}
</script>

<template>
  <div v-if="src" class="rc-canvas-head">
    <button class="rc-btn ghost" type="button" @click="backToList">← 返回列表</button>
    <div class="ch-switcher">
      <button class="ch-seg" :class="{ on: view === 'flow' }" type="button" @click="switchView('flow')">流程视图</button>
      <button class="ch-seg" :class="{ on: view === 'data' }" type="button" @click="switchView('data')">结果视图</button>
    </div>
    <div class="ch-titlewrap">
      <div class="ch-title">
        {{ src.name }}
        <span class="rc-status" :class="statusMeta.cls">{{ statusMeta.text }}</span>
        <span v-if="src.externalChanged" class="rc-status warn">外部变更待确认</span>
      </div>
      <div class="ch-sub">{{ metaLine }}</div>
    </div>
    <div class="ch-actions">
      <button class="rc-btn" type="button" @click="srcSnatch">发起抓取</button>
      <button class="rc-btn" type="button" @click="srcCopy">复制派生</button>
      <button class="rc-btn" :class="{ danger: !src.disabled }" type="button" @click="srcToggle">
        {{ src.disabled ? '启用' : '停用' }}
      </button>
      <button class="rc-btn" type="button" @click="router.push('/runs')">运行记录</button>
    </div>
  </div>
</template>

<style scoped>
.rc-canvas-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.ch-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; }
.ch-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.ch-seg.on { background: var(--rc-primary); color: #fff; }
.ch-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.ch-titlewrap { min-width: 0; }
.ch-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--rc-text); font-size: 13px; }
.ch-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.ch-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.ch-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.rc-btn.ghost { height: 28px; padding: 0 10px; font-size: 12px; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.rc-btn.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
.rc-btn.danger:hover { border-color: #f87171; background: #fef2f2; }
</style>
