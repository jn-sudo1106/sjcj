<script setup lang="ts">
// 网站详情页（0812 计划 M1-2/M1-4 纠偏）：网站汇总态只读聚合源/数据/文件三个视图，
// 没有流程视图（网站本身没有可编辑的单一流程），也没有任务页签（任务只在具体源和一级
// 任务中心查看，见 workspaceRoute.ts 的 SiteWorkspaceView）。
// 不再悄悄加载"代表源"：网站下可能有多张表、多个流程，拿第一个源的节点/表结构
// 冒充整个网站会得到错误结果（0812 会议结论）。数据/文件视图按 siteId 查询的真实实现见
// M2/M3；在那之前网站汇总态的数据/文件页签展示"开发中"占位，不渲染依赖 flow.sourceCtx
// 的旧 ResultView/FileView，避免用一个空的/串味的 flow.sourceCtx 发出错误查询。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { siteApi, type Site, type Source } from '@/api'
import { useFlowStore } from '@/stores/flow'
import { normalizeSiteView } from '@/utils/url/workspaceRoute'
import SourceOverviewView from './SourceOverviewView.vue'
import SiteDataView from './SiteDataView.vue'
import SiteFileView from './SiteFileView.vue'

const props = defineProps<{ siteId: string }>()
const route = useRoute()
const router = useRouter()
const flow = useFlowStore()

const site = ref<Site | null>(null)
const loadError = ref('')

// 过期请求保护：快速切换网站时，先发出的旧请求若比后发出的新请求更晚 resolve，
// 不能用旧网站的数据覆盖新网站已经展示的标题/上下文。
let loadSeq = 0
async function load() {
  const requestId = ++loadSeq
  loadError.value = ''
  const siteDetail = await siteApi.siteDetail(props.siteId)
  if (requestId !== loadSeq) return
  // 网站态不再注入任何代表源；只有用户点进具体源（openSource）才加载该源的流程。
  flow.clearSourceCtx()
  flow.setSiteDisplayCtx(siteDetail ?? null)
  site.value = siteDetail
  if (!siteDetail) loadError.value = '网站不存在或加载失败，请重试'
}
onMounted(load)
watch(() => props.siteId, load)
// 从网站详情切到源时，旧页面的异步加载不能再回写状态，避免覆盖新路由对应的源。
onUnmounted(() => {
  loadSeq += 1
})

const view = computed(() => normalizeSiteView(route.query.view))
function switchView(target: 'source' | 'data' | 'file') {
  if (view.value === target) return
  void router.replace({ path: '/canvas', query: { siteId: props.siteId, view: target } })
}
function openSource(source: Source) {
  // 保留网站上下文，进入具体源后左侧仍需加载同网站的源树。
  void router.replace({ path: '/canvas', query: { siteId: props.siteId, sourceId: source.sourceId, view: 'flow' } })
}
/** 点源列表的「数据量」数字（0903 Y1-15）：直接落到数据视图，不用先进流程再切一次 */
function openSourceData(source: Source) {
  void router.replace({ path: '/canvas', query: { siteId: props.siteId, sourceId: source.sourceId, view: 'data' } })
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
        <button class="sdv-seg" :class="{ on: view === 'source' }" type="button" data-testid="site-source-view" @click="switchView('source')">源视图</button>
        <button class="sdv-seg" :class="{ on: view === 'data' }" type="button" data-testid="site-data-view" @click="switchView('data')">数据视图</button>
        <button class="sdv-seg" :class="{ on: view === 'file' }" type="button" data-testid="site-file-view" @click="switchView('file')">文件视图</button>
      </div>
    </div>
    <div v-if="loadError" class="sdv-empty">{{ loadError }}</div>
    <template v-else>
      <SourceOverviewView v-if="view === 'source'" :current-site-id="siteId" class="sdv-body" @open-source="openSource" @open-source-data="openSourceData" />
      <SiteDataView v-else-if="view === 'data'" :site-id="siteId" class="sdv-body" />
      <SiteFileView v-else-if="view === 'file'" :site-id="siteId" class="sdv-body" />
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
