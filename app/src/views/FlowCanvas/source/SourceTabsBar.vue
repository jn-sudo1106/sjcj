<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { useWorkspaceStore, type SiteTab, type SourceTab } from '@/stores/workspace'
import { useFlowStore } from '@/stores/flow'

// 源详情工作区页签条（优化 0701 问题三 · 方案 B）：多个源并存为可关闭页签,视觉对齐原系统使用习惯。
// 首位是不可关闭的「源列表」固定页签：回列表后仍能看到已打开的源并可点回（0702 追加优化）。
//
// 0915-02：源页签之前再排一组「全部 · 网站名」。会上原话「全部没有放在 tab 上」——
// 在此之前网站聚合态不在页签条里，从"全部"点进某个源后要回去只能先回网站列表再点一次网站。
//
// 2026-09-16 两处修正：
//  ① **可以有多个**：源页签本来就允许跨网站，只留一个「全部」会在点了别的网站的源之后
//     把上一个网站的入口和快照一起弄丢；
//  ② **占额度、可关闭**：与源页签共用 8 个总额度（"多了也不好拉"——页签条横向滚动找页签
//     比重新打开还慢），既然占额度，就得能关。
const ws = useWorkspaceStore()
const flow = useFlowStore()
const router = useRouter()
const route = useRoute()

// 当前是否停在源列表页（页签条只挂在 /collect 与 /canvas 源详情两处）
const onList = computed(() => !route.path.startsWith('/canvas'))
// 网站聚合态 = 某个「全部」页签被激活：在 /canvas 上有 siteId、没有 sourceId
const onSiteAll = computed(() => !onList.value && !!route.query.siteId && !route.query.sourceId)
function isSiteActive(siteId: string) {
  return onSiteAll.value && String(route.query.siteId) === siteId
}

/** 点「全部」：回到该网站的聚合视图，并恢复上次停留的视图（默认源视图）。 */
function goSiteAll(tab: SiteTab) {
  if (isSiteActive(tab.siteId)) return
  const view = ws.siteSnapshotOf(tab.siteId)?.view || 'source'
  ws.deactivate() // 让出源页签的激活态，否则页签条上会同时有两个高亮
  void router.push({ path: '/canvas', query: { siteId: tab.siteId, view } })
}

/** 关掉某个网站页签。名下的源页签不动——它们各自记着 siteId，照常能切。 */
function onCloseSite(tab: SiteTab) {
  const wasActive = isSiteActive(tab.siteId)
  ws.closeSiteTab(tab.siteId)
  if (!wasActive) return
  // 关掉的正是当前所在的网站：没有别的地方可待，回网站列表
  router.push('/collect')
}

function navTo(key: string) {
  const snap = ws.snapshotOf(key)
  // 流程视图也必须显式带上 view=flow。否则 index.vue 会先补全 URL，
  // 但 sourceId 未变化，路由监听不会再次触发实际的 source 加载。
  const view = snap?.view === 'data' || snap?.view === 'task' || snap?.view === 'file' || snap?.view === 'flow'
    ? snap.view
    : 'flow'
  // 必须带上 siteId，否则切到别的网站下的源时左侧源列表会空：
  // 侧栏取的是 `flow.sourceCtx?.siteId || route.query.siteId`，而 sourceDetail 实测返回 siteId: null，
  // URL 再不带就两头落空（2026-08-28 修）。
  const siteId = snap?.siteId
  router.push({ path: '/canvas', query: { ...(siteId ? { siteId } : {}), sourceId: key, view } })
}

function onActivate(t: SourceTab) {
  if (!onList.value && t.sourceId === ws.activeSourceId) return
  ws.activate(t.sourceId)
  navTo(t.sourceId)
}

function goList() {
  if (onList.value) return
  ws.exitCompare() // 离开源详情工作区时退出临时的对比视图，回列表看到的是正常单栏页签
  router.push('/collect')
}

async function onClose(t: SourceTab) {
  // 关闭活动页签且画布有未保存改动 → 先确认（其余页签的状态只是快照，无未保存概念）
  if (t.sourceId === ws.activeSourceId && flow.dirty) {
    try {
      await ElMessageBox.confirm(`「${t.name}」画布有未保存的改动，关闭页签将丢弃，是否继续？`, '关闭页签', {
        type: 'warning',
        confirmButtonText: '关闭',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  const wasActive = t.sourceId === ws.activeSourceId
  const next = ws.close(t.sourceId)
  // 在源列表页关闭页签只更新页签条，不跳转；在源详情页关闭活动页签才切换到相邻页签/回列表
  if (!wasActive || onList.value) return
  if (next) navTo(next)
  else router.push('/collect')
}

// 清空全部页签（0707 采集资产样式优化，对齐原型稿「6/8 清空」）：正在画布且有未保存改动时先确认
async function onCloseAll() {
  if (!onList.value && flow.dirty) {
    try {
      await ElMessageBox.confirm('当前画布有未保存的改动，清空页签将丢弃，是否继续？', '清空页签', {
        type: 'warning',
        confirmButtonText: '清空',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
  }
  ws.exitCompare()
  ;[...ws.tabs].forEach((t) => ws.close(t.sourceId))
  ws.clearSiteTabs()
  if (!onList.value) router.push('/collect')
}
</script>

<template>
  <div v-if="ws.tabs.length || ws.siteTabs.length" class="rc-src-tabs">
    <!-- 只有页签这一段横向滚动；「n/8 清空」在下面的固定区里（2026-09-16 走查：
         之前整条一起滚，页签一多「清空」就被挤到屏幕外，满 8 个想清理反而得先滚过去找按钮） -->
    <div class="rc-src-tabs-scroll" role="tablist">
    <button
      class="rc-src-tab list-tab"
      :class="{ on: onList }"
      type="button"
      role="tab"
      :aria-selected="onList"
      title="返回网站列表"
      @click="goList"
    >
      <span class="rc-src-tab-name">网站列表</span>
    </button>
    <button
      v-for="st in ws.siteTabs"
      :key="st.siteId"
      class="rc-src-tab site-tab"
      :class="{ on: isSiteActive(st.siteId) }"
      type="button"
      role="tab"
      data-testid="site-all-tab"
      :aria-selected="isSiteActive(st.siteId)"
      :title="`${st.name} · 全部源`"
      @click="goSiteAll(st)"
    >
      <span class="rc-src-tab-name">全部 · {{ st.name }}</span>
      <i class="rc-src-tab-x" aria-label="关闭页签" data-testid="site-all-tab-close" @click.stop="onCloseSite(st)">×</i>
    </button>
    <button
      v-for="t in ws.tabs"
      :key="t.sourceId"
      class="rc-src-tab"
      :class="{ on: !onList && !onSiteAll && t.sourceId === ws.activeSourceId }"
      type="button"
      role="tab"
      :aria-selected="!onList && !onSiteAll && t.sourceId === ws.activeSourceId"
      :title="`${t.name} · ${t.sourceId}`"
      @click="onActivate(t)"
    >
      <span class="rc-src-tab-name">{{ t.name }}</span>
      <i class="rc-src-tab-x" aria-label="关闭页签" @click.stop="onClose(t)">×</i>
    </button>
    </div>
    <div class="rc-src-tabs-actions">
      <span v-if="ws.compareSourceId" class="rc-src-compare-on">
        对比中 · <button type="button" class="rc-src-compare-exit" @click="ws.exitCompare()">退出</button>
      </span>
      <span class="rc-src-tabs-hint" :class="{ full: ws.tabs.length + ws.siteTabs.length >= 8 }">{{ ws.tabs.length + ws.siteTabs.length }}/8</span>
      <button class="rc-src-clear" type="button" title="关闭全部页签" @click="onCloseAll">清空</button>
    </div>
  </div>
</template>

<style scoped>
/* 0707 采集资产样式优化：对齐原型稿（采集中心卡片样式.png 第二行）——旧"浏览器标签"形态（方顶圆角+底边线）
   改为圆角胶囊 chips；「源列表」与激活页签用浅蓝底+蓝描边胶囊，其余白底胶囊，尾部「n/8 清空」 */
.rc-src-tabs { display: flex; align-items: center; gap: 10px; padding: 0 0 10px; }
/* 页签区：可滚动、可收缩（min-width:0 是关键，否则 flex 子项按内容宽度撑开，右侧操作区会被挤出屏幕） */
.rc-src-tabs-scroll { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; overflow-x: auto; scrollbar-width: thin; }
/* 操作区：钉在右端，不随页签滚动，满额时也一眼可点 */
.rc-src-tabs-actions { flex: none; display: flex; align-items: center; gap: 8px; }
.rc-src-tab {
  display: inline-flex; align-items: center; gap: 6px; max-width: 220px; flex: none; height: 30px;
  padding: 0 8px 0 12px; border: 1px solid var(--rc-border); border-radius: 8px;
  background: #fff; color: var(--rc-text-2); font-size: 12px; cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.rc-src-tab:hover { border-color: #93c5fd; color: var(--rc-primary-ink); }
.rc-src-tab.on { border-color: var(--rc-primary); background: var(--rc-primary-bg); color: var(--rc-primary-ink); font-weight: 700; }
.rc-src-tab.list-tab { padding-right: 12px; font-weight: 700; }
/* 「全部」排在源页签之前，字重与「网站列表」一致，和普通源页签区分开 */
.rc-src-tab.site-tab { font-weight: 700; }
.rc-src-tab-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rc-src-tab-x { flex: none; font-style: normal; font-size: 13px; line-height: 1; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: var(--rc-faint); }
.rc-src-tab-x:hover { background: var(--rc-error-bg, #fee2e2); color: var(--rc-error, #dc2626); }
.rc-src-tabs-hint { flex: none; color: var(--rc-faint); font-size: 11px; }
/* 满额时把计数标红：新开页签会被拒，得先关几个 */
.rc-src-tabs-hint.full { color: var(--rc-error); font-weight: 700; }
.rc-src-clear { flex: none; border: 0; background: transparent; color: var(--rc-muted); font-size: 11px; cursor: pointer; padding: 2px 4px; border-radius: 5px; }
.rc-src-clear:hover { color: var(--rc-error); background: var(--rc-error-bg, #fee2e2); }
.rc-src-compare-on { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--rc-primary-ink); }
.rc-src-compare-exit { border: 0; background: transparent; color: var(--rc-primary); font-size: 11px; font-weight: 700; cursor: pointer; padding: 0; text-decoration: underline; }
</style>
