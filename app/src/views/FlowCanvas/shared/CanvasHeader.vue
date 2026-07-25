<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../../stores/flow'
import { useUiStore } from '../../../stores/ui'
import { flowTemplateApi, sourceApi, type FlowTemplate } from '../../../api'
import { normalizeSourceView, sourceViewFromHash, type SourceWorkspaceView } from '@/utils/url/workspaceRoute'
import SyncSourcesDialog from './SyncSourcesDialog.vue'

const flow = useFlowStore()
const ui = useUiStore()
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

const templates = ref<FlowTemplate[]>([])
async function loadTemplates() {
  templates.value = await flowTemplateApi.list()
}
function onTemplateDropdownVisible(visible: boolean) {
  if (visible) void loadTemplates()
}
onMounted(() => { void loadTemplates() })

// 顶部下拉既是模板切换入口，也要明确当前子源实际应用的是哪一版模板。
// 模板列表尚未加载、或旧存量流程没有模板绑定时，才回退到通用动作文案。
const appliedTemplateLabel = computed(() => {
  const templateId = src.value?.templateId
  if (!templateId) return '切换模板'
  const template = templates.value.find((item) => item.id === templateId)
  return template ? `${template.name} · v${src.value?.templateVersion ?? template.version}` : '切换模板'
})

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
// 参数源（0721 会议 T5）：只读摘要——普通源的 url 换成"参数源 · 模板 · N 个参数占位符"；
// 具体每个参数的真实取值数需要逐个查详情，摘要头不为此额外发请求，只读 paramRefs 数量。
const metaLine = computed(() => {
  const s = src.value
  if (!s) return ''
  const primary = s.kind === 'param' ? `参数子源 · ${s.urlTemplate || s.baseUrl || ''} · ${s.paramRefs?.length ?? 0} 个参数占位符` : s.url
  return [primary, s.lastSuccessAt ? `上次成功 ${s.lastSuccessAt}` : ''].filter(Boolean).join(' · ')
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

// 发起抓取（0714 会议 Task 4）：唯一的完整执行入口——本组件只派发动作，
// 校验/请求/驱动运行态统一收在 index.vue（走 ui 动作总线，避免在 FlowBoard/ResultView/TaskView/FileView
// 四处宿主组件里各自转发一遍事件）。
function srcSnatch() {
  ui.fireAction('发起抓取')
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

// 同步到子源（0716）：把当前子源已保存的流程批量覆盖到同网站其他子源。
// 永远同步已保存的版本——画布有未保存改动时先拦下，避免"画布上是 A、同步出去是 B"。
const syncOpen = ref(false)
function openSyncDialog() {
  if (flow.dirty) {
    ElMessage.warning('画布有未保存的改动，请先保存当前流程')
    return
  }
  syncOpen.value = true
}

async function onSwitchFlow(command: string) {
  if (!command) return
  if (command === '__manage_templates__') {
    void router.push({ path: '/collect', query: { tab: 'template' } })
    return
  }
  const template = templates.value.find((item) => item.id === command)
  if (!template || !src.value) return
  if (flow.dirty) {
    try {
      await ElMessageBox.confirm(
        '当前画布有未保存改动。切换模板会按稳定节点 ID 保留兼容绑定，并清理不兼容绑定，是否继续？',
        '切换流程模板',
        { type: 'warning', confirmButtonText: '切换', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  const result = flow.applyTemplate(template)
  if (!result) return
  ElMessage.success(`已应用模板「${template.name}」v${template.version}${result.cleared ? `，已清理 ${result.cleared} 项不兼容绑定` : ''}`)
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
        <el-dropdown trigger="click" @command="onSwitchFlow" @visible-change="onTemplateDropdownVisible">
          <button class="rc-btn" style="margin-right: 8px;" type="button">
            {{ appliedTemplateLabel }} ▾
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="template in templates" :key="template.id" :command="template.id">
                {{ template.name }} · v{{ template.version }}
              </el-dropdown-item>
              <el-dropdown-item divided command="__manage_templates__">管理流程模板…</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <button v-if="src.siteId" class="rc-btn" type="button" title="把当前子源已保存的流程覆盖到同网站其他子源" @click="openSyncDialog">同步到子源…</button>
        <!-- 保存从 AppShell 顶栏迁入画布 Header（贴着它作用的画布）；与发起抓取同走动作总线，处理函数在 index.vue -->
        <button class="rc-btn primary" :class="{ dirty: flow.dirty }" type="button" :title="flow.dirty ? '画布有未保存的改动' : undefined" @click="ui.fireAction('保存')">
          保存
        </button>
      </div>
      <div v-if="view === 'flow'" class="ch-canvas-actions" aria-label="子源运行操作">
        <button class="rc-btn primary" type="button" @click="srcSnatch">发起抓取</button>
        <button class="rc-btn" :class="{ danger: !src.disabled }" type="button" @click="srcToggle">
          {{ src.disabled ? '启用' : '停用' }}
        </button>
      </div>
    </template>

    <SyncSourcesDialog v-if="src.siteId" v-model:open="syncOpen" :site-id="src.siteId" :from-source="src" />
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
.ch-actions .rc-btn.primary.dirty { position: relative; }
.ch-actions .rc-btn.primary.dirty::after { content: ''; position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--rc-warn); border: 1.5px solid #fff; }
.ch-canvas-actions { position: absolute; z-index: 4; right: 32px; top: calc(100% + 18px); display: flex; gap: 6px; }
.ch-canvas-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.rc-btn.ghost { height: 28px; padding: 0 10px; font-size: 12px; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.rc-btn.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
.rc-btn.danger:hover { border-color: #f87171; background: #fef2f2; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
</style>
