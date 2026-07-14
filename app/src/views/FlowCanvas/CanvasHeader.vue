<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { sourceApi } from '../../api'
import { PRESET_INTENTS } from './flowModel'
import { normalizeSourceView, sourceViewFromHash, type SourceWorkspaceView } from './workspaceRoute'

const flow = useFlowStore()
const route = useRoute()
const router = useRouter()

const src = computed(() => flow.sourceCtx)
const view = ref<SourceWorkspaceView>(normalizeSourceView(route.query.view))
function syncView() {
  view.value = sourceViewFromHash(window.location.hash)
}
watch(() => route.query.view, (next) => {
  view.value = normalizeSourceView(next)
}, { immediate: true })
onMounted(() => window.addEventListener('hashchange', syncView))
onBeforeUnmount(() => window.removeEventListener('hashchange', syncView))

const statusMeta = computed(() => {
  const s = src.value
  if (!s) return { cls: 'muted', text: '' }
  if (s.disabled) return { cls: 'muted', text: '已停用' }
  if (s.state === 'C') return { cls: 'ok', text: '成功' }
  if (s.state === 'E') return { cls: 'err', text: '出错' }
  if (s.state === 'L') return { cls: 'run', text: '运行中' }
  return { cls: 'muted', text: '未知' }
})
// 摘要头只展示运行所需信息；子源 ID、分类和标签不在此处暴露。
const metaLine = computed(() => {
  const s = src.value
  if (!s) return ''
  return [
    s.url,
    s.owner ? `负责人 ${s.owner}` : '',
    s.lastSuccessAt ? `上次成功 ${s.lastSuccessAt}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
})
function backToList() {
  router.push('/collect')
}
function switchView(target: 'flow' | 'data' | 'task' | 'file') {
  if (view.value === target) return
  const query = { ...route.query }
  if (target === 'flow') delete query.view
  else query.view = target
  void router.replace({ path: '/canvas', query })
}

async function srcSnatch() {
  const s = src.value
  if (!s) return
  const res = await sourceApi.sendSnatch([s.sourceId])
  ElMessage.success(res?.message || '已发起抓取（演示）')
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

function onSwitchFlow(command: string) {
  if (!command) return
  if (command === '__new_blank__') {
    flow.newFlow('blank')
    ElMessage.success('已新建空白流程')
    return
  }
  const preset = PRESET_INTENTS.find((p) => p.key === command)
  if (preset) {
    flow.load(preset.build())
    ElMessage.success(`已应用模板：${preset.label}`)
  } else {
    ElMessage.info(`模拟加载：${command}`)
  }
}
</script>

<template>
  <div v-if="src" class="rc-canvas-head">
    <button class="rc-btn ghost" type="button" @click="backToList">← 返回列表</button>
    <div class="ch-switcher">
      <button class="ch-seg" :class="{ on: view === 'flow' }" type="button" @click="switchView('flow')">流程视图</button>
      <button class="ch-seg" :class="{ on: view === 'data' }" type="button" @click="switchView('data')">数据视图</button>
      <button class="ch-seg" :class="{ on: view === 'file' }" type="button" @click="switchView('file')">文件视图</button>
      <button class="ch-seg" :class="{ on: view === 'task' }" type="button" @click="switchView('task')">任务视图</button>
    </div>

    <template v-if="src">
      <div class="ch-titlewrap">
        <div class="ch-title">
          {{ src.name }}
          <span class="rc-status" :class="statusMeta.cls">{{ statusMeta.text }}</span>
          <span v-if="src.externalChanged" class="rc-status warn">外部变更待确认</span>
        </div>
        <div class="ch-sub">{{ metaLine }}</div>
      </div>
      <div v-if="view === 'flow'" class="ch-actions">
        <el-dropdown trigger="click" @command="onSwitchFlow">
          <button class="rc-btn" style="margin-right: 8px;" type="button">
            切换流程 ▾
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="p in PRESET_INTENTS" :key="p.key" :command="p.key">{{ p.label }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div v-if="view === 'flow'" class="ch-canvas-actions" aria-label="子源运行操作">
        <button class="rc-btn primary" type="button" @click="srcSnatch">发起抓取</button>
        <button class="rc-btn" :class="{ danger: !src.disabled }" type="button" @click="srcToggle">
          {{ src.disabled ? '启用' : '停用' }}
        </button>
      </div>
    </template>

  </div>
</template>

<style scoped>
.rc-canvas-head { position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.ch-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; }
.ch-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.ch-seg.on { background: var(--rc-primary); color: #fff; }
.ch-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.ch-seg:disabled { color: var(--rc-faint); cursor: not-allowed; }
.ch-titlewrap { min-width: 0; }
.ch-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--rc-text); font-size: 13px; }
.ch-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.ch-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.ch-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.ch-canvas-actions { position: absolute; z-index: 4; right: 32px; top: calc(100% + 18px); display: flex; gap: 6px; }
.ch-canvas-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.rc-btn.ghost { height: 28px; padding: 0 10px; font-size: 12px; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.rc-btn.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
.rc-btn.danger:hover { border-color: #f87171; background: #fef2f2; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
</style>
