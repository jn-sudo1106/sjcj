<script setup lang="ts">
// 网站详情页（0714 会议 Task 3）：点击网站不再重定向到第一个子源，落在这个页面上——
// 只读聚合数据/文件/任务三个视图（没有流程视图，网站本身没有可编辑的单一流程）。
// 内部悄悄加载一个代表子源（同网站下子源共享流程/表结构）供 ResultView/FileView/TaskView 取得
// 查询所需的节点/表结构，但不走 ws.open（不登记页签、不出现在页签条里，用户看到的是"网站"而非某个具体子源）。
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { flowApi, sourceApi, siteApi, type Site } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { firstSourceId, normalizeSiteView } from '@/utils/url/workspaceRoute'
import ResultView from './ResultView.vue'
import FileView from './FileView.vue'
import TaskView from './TaskView.vue'

const props = defineProps<{ siteId: string }>()
const route = useRoute()
const router = useRouter()
const flow = useFlowStore()

const site = ref<Site | null>(null)
const loadError = ref('')

// 过期请求保护（与 FileView/TaskView 的 xxxRequest 计数同一套口径）：快速切换网站时，
// 先发出的旧请求若比后发出的新请求更晚 resolve，不能覆盖新网站已经写入 flow store 的数据。
let loadSeq = 0
async function load() {
  const requestId = ++loadSeq
  loadError.value = ''
  const [siteDetail, children] = await Promise.all([siteApi.siteDetail(props.siteId), siteApi.siteSources(props.siteId)])
  if (requestId !== loadSeq) return
  site.value = siteDetail
  const repId = firstSourceId(children)
  if (!repId) {
    loadError.value = '该网站暂无子源，请先添加子源'
    flow.clearSourceCtx()
    flow.setSiteDisplayCtx(siteDetail ?? null)
    return
  }
  // repId 就是 children 里那条记录自己的 sourceId，siteSources 和 sourceDetail 读的是同一份数据，
  // 不用再单独发一次 sourceDetail 请求。
  const source = children.find((c) => c.sourceId === repId) ?? null
  const [steps, persistedDef] = await Promise.all([
    sourceApi.sourceSteps(repId),
    flowApi.flowLoad(repId),
  ])
  if (requestId !== loadSeq) return
  if (!source) {
    loadError.value = '子源加载失败，请重试'
    return
  }
  // 先加载代表子源供数据查询，再补设 siteCtx 供顶部面包屑/动作栏识别为网站态展示——
  // loadFromSource 内部会重置 siteCtx，顺序不能反过来（见 flow.ts setSiteDisplayCtx 注释）。
  flow.loadFromSource(source, steps ?? [], persistedDef)
  flow.setSiteDisplayCtx(siteDetail ?? null)
}
onMounted(load)
watch(() => props.siteId, load)

const view = computed(() => normalizeSiteView(route.query.view))
function switchView(target: 'data' | 'file' | 'task') {
  if (view.value === target) return
  void router.replace({ path: '/canvas', query: { siteId: props.siteId, view: target } })
}
</script>

<template>
  <main class="sdv-shell">
    <div class="sdv-head">
      <div class="sdv-titlewrap">
        <div class="sdv-title">{{ site?.name || '网站详情' }}<span class="rc-status muted">网站汇总</span></div>
        <div class="sdv-sub">{{ site?.categoryPath || site?.category || '' }}</div>
      </div>
      <div class="sdv-switcher">
        <button class="sdv-seg" :class="{ on: view === 'data' }" type="button" @click="switchView('data')">数据视图</button>
        <button class="sdv-seg" :class="{ on: view === 'file' }" type="button" @click="switchView('file')">文件视图</button>
        <button class="sdv-seg" :class="{ on: view === 'task' }" type="button" @click="switchView('task')">任务视图</button>
      </div>
    </div>
    <div v-if="loadError" class="sdv-empty">{{ loadError }}</div>
    <template v-else>
      <ResultView v-if="view === 'data'" site-wide class="sdv-body" />
      <FileView v-else-if="view === 'file'" site-wide class="sdv-body" />
      <TaskView v-else site-wide class="sdv-body" />
    </template>
  </main>
</template>

<style scoped>
.sdv-shell { display: flex; flex-direction: column; height: 100%; }
.sdv-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--rc-border-soft); background: #fff; flex-wrap: wrap; }
.sdv-titlewrap { min-width: 0; }
.sdv-title { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; color: var(--rc-text); font-size: 13px; }
.sdv-sub { color: var(--rc-faint); font-size: 10px; margin-top: 1px; }
.sdv-switcher { display: inline-flex; padding: 2px; background: #f1f5f9; border: 1px solid var(--rc-border); border-radius: 7px; margin-left: auto; }
.sdv-seg { height: 26px; padding: 0 12px; border: 0; background: transparent; color: var(--rc-text-2); font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 5px; }
.sdv-seg.on { background: var(--rc-primary); color: #fff; }
.sdv-seg:hover:not(.on) { color: var(--rc-primary-ink); }
.sdv-body { flex: 1; min-height: 0; }
.sdv-empty { padding: 40px 12px; text-align: center; color: var(--rc-faint); font-size: 12px; }
</style>
