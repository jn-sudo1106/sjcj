<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '@/stores/flow'
import { useUiStore } from '@/stores/ui'
import { flowCenterApi, type FlowRecord } from '@/api'
import { normalizeSourceView, sourceViewFromHash, type SourceWorkspaceView } from '@/utils/url/workspaceRoute'
import { useFlowAutosave } from '@/views/FlowCanvas/canvas/useFlowAutosave'

const flow = useFlowStore()
const ui = useUiStore()
const { status: saveStatus, savedClock, flush: retryFlowSave } = useFlowAutosave()
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

const templates = ref<FlowRecord[]>([])
async function loadTemplates() {
  templates.value = await flowCenterApi.list()
}
function onTemplateDropdownVisible(visible: boolean) {
  if (visible) void loadTemplates()
}
onMounted(() => { void loadTemplates() })

// 顶部下拉是流程切换入口；内部沿用既有版本化接口，用户界面不再暴露“模板”概念。
const appliedTemplateLabel = computed(() => {
  const templateId = src.value?.templateId
  if (!templateId) return '切换流程'
  const template = templates.value.find((item) => item.id === templateId)
  return template ? `${template.name} · v${src.value?.templateVersion ?? template.version}` : '切换流程'
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
// 摘要头只展示运行所需信息；源 ID、分类和标签不在此处暴露。
// 参数源（0721 会议 T5）：只读摘要——普通源的 url 换成"参数源 · 模板 · N 个参数占位符"；
// 具体每个参数的真实取值数需要逐个查详情，摘要头不为此额外发请求，只读 paramRefs 数量。
const metaLine = computed(() => {
  const s = src.value
  if (!s) return ''
  const primary = s.kind === 'param' ? `参数源 · ${s.urlTemplate || s.baseUrl || ''} · ${s.paramRefs?.length ?? 0} 个参数占位符` : s.url
  return [primary, s.lastSuccessAt ? `上次成功 ${s.lastSuccessAt}` : ''].filter(Boolean).join(' · ')
})
/**
 * 返回源视图（0828 W5-6/7 合并）。
 *
 * 原来是「返回列表」→ `/collect`（网站列表）。会上明确不要回网站列表：
 * 「你这个返回不要返回到网站」「我点个返回的源列表」。
 * 落点是**当前源所属网站**的源视图（单网站），不是全网站。
 * 这也把原计划里单独加一个「源视图」入口按钮那条合并掉了：一个返回按钮就够，不再多摆一个。
 *
 * 归属网站按既有优先级取：源上下文 > URL。游离源（无网站归属，见 0824-11 §1.2c-3）
 * 没有可回的源视图，退回网站列表。
 */
function backToSourceView() {
  const siteId = src.value?.siteId || String(route.query.siteId ?? '')
  if (siteId) router.push({ path: '/canvas', query: { siteId, view: 'source' } })
  else router.push('/collect')
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

async function onSwitchFlow(command: string) {
  if (!command) return
  if (command === '__manage_flows__') {
    void router.push('/flows')
    return
  }
  const template = templates.value.find((item) => item.id === command)
  if (!template || !src.value) return
  if (flow.dirty) {
    try {
      await ElMessageBox.confirm(
        '当前画布有未保存改动。切换流程会全量替换当前节点，是否继续？',
        '切换流程',
        { type: 'warning', confirmButtonText: '切换', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  const result = flow.applyTemplate(template)
  if (!result) return
  ElMessage.success(`已应用流程「${template.name}」v${template.version}${result.cleared ? `，原 ${result.cleared} 个节点已替换` : ''}`)
}

</script>

<template>
  <div v-if="src" class="rc-canvas-head">
    <button class="rc-btn ghost" type="button" @click="backToSourceView">← 返回源视图</button>
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
              <el-dropdown-item divided command="__manage_flows__">管理流程…</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <!-- 0828 W9-2/D06：步骤接口已通，拓扑/进入条件防抖自动保存；不再放手动保存按钮。 -->
        <span class="ch-save-status" data-testid="flow-save-status">
          <template v-if="saveStatus === 'saving'">保存中…</template>
          <template v-else-if="saveStatus === 'saved'">已保存 {{ savedClock }}</template>
          <button
            v-else-if="saveStatus === 'error'"
            class="ch-save-retry"
            type="button"
            @click="void retryFlowSave()"
          >保存失败，点击重试</button>
        </span>
      </div>
      <!-- 「停用」0828 D24 移除：源启停统一在源视图的行操作里做，画布头只留运行入口。
           这里不做成禁用或隐藏——按钮整个删掉，避免同一能力两个入口。 -->
      <div v-if="view === 'flow'" class="ch-canvas-actions" aria-label="源运行操作">
        <button class="rc-btn primary" type="button" @click="srcSnatch">发起抓取</button>
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
.ch-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
.ch-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.ch-save-status { color: var(--rc-faint); font-size: 12px; min-height: 18px; min-width: 4em; }
.ch-save-retry { border: 0; background: transparent; color: #b91c1c; font-size: 12px; cursor: pointer; padding: 0; }
.ch-save-retry:hover { text-decoration: underline; }
.ch-canvas-actions { position: absolute; z-index: 4; right: 32px; top: calc(100% + 18px); display: flex; gap: 6px; }
.ch-canvas-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.rc-btn.ghost { height: 28px; padding: 0 10px; font-size: 12px; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.rc-btn.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
.rc-btn.danger:hover { border-color: #f87171; background: #fef2f2; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
</style>
