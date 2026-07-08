<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useFlowStore } from '../../stores/flow'
import { sourceApi, type Source } from '../../api'
import SourceBasicForm from './SourceBasicForm.vue'

const flow = useFlowStore()
const route = useRoute()
const router = useRouter()

const src = computed(() => flow.sourceCtx)
const site = computed(() => flow.siteCtx)
const view = computed(() => (route.query.view === 'data' ? 'data' : route.query.view === 'task' ? 'task' : 'flow'))
// 网站态摘要行（0707 优化·Phase4）：网站是流程模板，没有 state/URL 等运行态字段，展示与源不同的一组元数据
const siteMetaLine = computed(() => {
  const s = site.value
  if (!s) return ''
  return [
    s.siteId,
    s.categoryPath || s.category,
    s.tags?.length ? `标签 ${s.tags.join('/')}` : '',
    s.owner ? `负责人 ${s.owner}` : '',
    s.updatedAt ? `更新于 ${s.updatedAt}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
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
// 摘要头元数据行（0706 Phase4·调整6）：显式承载源标识元数据——源ID/URL/分类/标签，随时定位对应源
const metaLine = computed(() => {
  const s = src.value
  if (!s) return ''
  return [
    s.sourceId,
    s.url,
    s.category,
    s.tags?.length ? `标签 ${s.tags.join('/')}` : '',
    s.owner ? `负责人 ${s.owner}` : '',
    s.lastSuccessAt ? `上次成功 ${s.lastSuccessAt}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
})

function backToList() {
  router.push('/collect')
}
function switchView(target: 'flow' | 'data' | 'task') {
  if (view.value === target) return
  const query = { ...route.query }
  if (target === 'flow') delete query.view
  else query.view = target
  router.push({ path: '/canvas', query })
}

// ---- 源信息编辑抽屉（0706 Phase4·调整6）：摘要头是唯一源级配置编辑入口，抽屉复用 SourceBasicForm ----
const editOpen = ref(false)
const editDraft = ref<Source | null>(null)
function openEdit() {
  const base = flow.sourceCfg ?? src.value
  if (!base) return
  editDraft.value = JSON.parse(JSON.stringify(base)) as Source
  editOpen.value = true
}
async function saveEdit() {
  const d = editDraft.value
  if (!d) return
  if (!d.name || !d.category) {
    ElMessage.warning('源名称 / 分类为必填')
    return
  }
  try {
    // updateSource 属危险端点，沿用二次确认约定
    await ElMessageBox.confirm(`将保存源「${d.name}」的基础信息，是否继续？`, '保存源信息', {
      type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const res = await sourceApi.sourceUpdate(d)
  if (!res?.ok) {
    ElMessage.warning(res?.message || '保存失败，请重试')
    return
  }
  // 同步回画布上下文：摘要头（sourceCtx）与流程序列化层（sourceCfg）都吃到最新值
  if (flow.sourceCtx) Object.assign(flow.sourceCtx, d)
  flow.patchSource(d)
  editOpen.value = false
  ElMessage.success(res?.message || '源信息已保存')
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
  <div v-if="src || site" class="rc-canvas-head">
    <button class="rc-btn ghost" type="button" @click="backToList">← 返回列表</button>
    <div class="ch-switcher">
      <button class="ch-seg" :class="{ on: view === 'flow' }" type="button" @click="switchView('flow')">流程视图</button>
      <button class="ch-seg" :class="{ on: view === 'data' }" type="button" @click="switchView('data')">数据视图</button>
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
      <div class="ch-actions">
        <button class="rc-btn" type="button" @click="openEdit">编辑</button>
        <button class="rc-btn" type="button" @click="srcSnatch">发起抓取</button>
        <button class="rc-btn" type="button" @click="srcCopy">复制派生</button>
        <button class="rc-btn" :class="{ danger: !src.disabled }" type="button" @click="srcToggle">
          {{ src.disabled ? '启用' : '停用' }}
        </button>
        <button class="rc-btn" type="button" @click="router.push('/runs')">运行记录</button>
      </div>
    </template>
    <template v-else-if="site">
      <div class="ch-titlewrap">
        <div class="ch-title">
          {{ site.name }}
          <span class="rc-status muted">网站模板</span>
        </div>
        <div class="ch-sub">{{ siteMetaLine }}</div>
      </div>
      <div class="ch-actions">
        <span class="ch-site-hint">网站不实际运行；保存后可选择同步覆盖到子源</span>
      </div>
    </template>

    <!-- 源信息编辑抽屉（0706 Phase4）：源级配置的唯一编辑入口，任意视图下经摘要头可达 -->
    <el-drawer v-if="src" v-model="editOpen" title="编辑源信息" size="480px" :append-to-body="true">
      <SourceBasicForm v-if="editDraft" v-model="editDraft" :source-id-editable="false" />
      <template #footer>
        <div class="ch-drawer-foot">
          <button class="rc-btn" type="button" @click="editOpen = false">取消</button>
          <button class="rc-btn primary" type="button" @click="saveEdit">保存</button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.rc-canvas-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.ch-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; }
.ch-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.ch-seg.on { background: var(--rc-primary); color: #fff; }
.ch-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.ch-seg:disabled { color: var(--rc-faint); cursor: not-allowed; }
.ch-site-hint { color: var(--rc-faint); font-size: 11px; }
.ch-titlewrap { min-width: 0; }
.ch-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--rc-text); font-size: 13px; }
.ch-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.ch-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; justify-content: flex-end; }
.ch-actions .rc-btn { height: 30px; padding: 0 11px; font-size: 12px; }
.rc-btn.ghost { height: 28px; padding: 0 10px; font-size: 12px; border-color: var(--rc-border); background: transparent; color: var(--rc-text-2); }
.rc-btn.ghost:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.rc-btn.danger { border-color: #fecaca; color: #b91c1c; background: #fff; }
.rc-btn.danger:hover { border-color: #f87171; background: #fef2f2; }
.rc-btn.primary { border-color: var(--rc-primary); background: var(--rc-primary); color: #fff; }
.ch-drawer-foot { display: flex; justify-content: flex-end; gap: 8px; }
</style>
