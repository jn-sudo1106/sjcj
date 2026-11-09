<script setup lang="ts">
// 总览说明条右端的「我的收藏」入口（1108-总览页我的收藏入口，设计稿见
// 设计稿/设计方案/1108-总览页我的收藏入口_设计方案_2026-11-08.md）。
//
// 为什么挂说明条而不是动作区 / KPI / 侧栏：总览是"全站态势"的公共看板，收藏是个人捷径；
// 说明条右端那组是「关于这份数据、关于你」的元信息带，和时间戳同一层，不打断 KPI 栅格。
//
// 弹层只做「数量 + 跳转」：`favorite/list` 只回 itemId 不回名称，展示名称要按 ID 逐个查详情，
// 首屏会放大 N 个请求，等后端补字段再升级。
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { favoriteSummary } from '@/utils/favoriteSummary'

const router = useRouter()
const open = ref(false)

const summary = favoriteSummary
const loading = computed(() => summary.value.loading)
const failed = computed(() => summary.value.failed)
const empty = computed(() => summary.value.empty)
/** 只有真正拿到过数字才显示徽标：加载中不显示（避免 0 → 12 跳变），失败不显示（0 是假象） */
const showCount = computed(() => !loading.value && !failed.value && summary.value.total > 0)
const chipLabel = computed(() =>
  showCount.value ? `我的收藏，共 ${summary.value.total} 项` : '我的收藏',
)

function goCollect() {
  open.value = false
  void router.push({ path: '/collect', query: { tab: 'favorite' } })
}

function goTables() {
  open.value = false
  // fav=1 让表 ID 列表直接落在「只看收藏」（EntryTab 读这个参数，见其 setup 里的路由同步）
  void router.push({ path: '/data', query: { tab: 'entry', fav: '1' } })
}
</script>

<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-end"
    :width="300"
    :offset="8"
    :show-arrow="true"
    popper-class="ov-fav-popper"
  >
    <template #reference>
      <button
        type="button"
        class="ov-fav"
        :class="{ 'is-empty': empty, 'is-failed': failed }"
        :aria-label="chipLabel"
        :aria-expanded="open ? 'true' : 'false'"
        data-testid="overview-favorite-entry"
      >
        <svg class="ov-fav-star" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.6l2.9 6.1 6.7.9-4.9 4.7 1.2 6.6-5.9-3.2-5.9 3.2 1.2-6.6L2.4 9.6l6.7-.9L12 2.6z" />
        </svg>
        <span>我的收藏</span>
        <b v-if="showCount">{{ summary.total }}</b>
      </button>
    </template>

    <div class="ov-fav-pop" role="menu" aria-label="我的收藏">
      <div class="ov-fav-h">
        <b>我的收藏</b>
        <span v-if="loading">正在统计…</span>
        <span v-else-if="failed">收藏数量暂时取不到</span>
        <span v-else>网站、源、数据表的收藏都在这里</span>
      </div>

      <p v-if="failed" class="ov-fav-err">收藏数量加载失败，可先直接打开收藏列表</p>

      <div v-if="empty" class="ov-fav-empty">
        <span>还没有收藏任何内容</span>
        <button type="button" class="ov-fav-empty-go" @click="goCollect">
          去采集资产逛逛 ›
        </button>
      </div>

      <template v-else>
        <button type="button" class="ov-fav-row" role="menuitem" @click="goCollect">
          <span class="ov-fav-icon site" aria-hidden="true">站</span>
          <span class="ov-fav-text">
            <b>采集网站与源</b>
            <span v-if="loading" class="ov-fav-skel" />
            <span v-else>网站 {{ summary.sites }} · 源 {{ summary.sources }}</span>
          </span>
          <span class="ov-fav-n">{{ loading ? '—' : summary.collected }}<i>›</i></span>
        </button>

        <button type="button" class="ov-fav-row" role="menuitem" @click="goTables">
          <span class="ov-fav-icon tbl" aria-hidden="true">表</span>
          <span class="ov-fav-text">
            <b>数据表</b>
            <span>数据中心 · 表 ID 列表</span>
          </span>
          <span class="ov-fav-n">{{ loading ? '—' : summary.entries }}<i>›</i></span>
        </button>
      </template>

      <div class="ov-fav-f">在网站、源或数据表列表点 ☆ 即可收藏</div>
    </div>
  </el-popover>
</template>

<style scoped>
/* 胶囊：橙色系而非主题蓝——蓝色留給页级主按钮（新建采集），收藏是个人偏好 */
.ov-fav {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 9px 0 8px;
  border: 1px solid #fcd9a2;
  border-radius: 999px;
  background: #fffdf7;
  color: #92400e;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.ov-fav:hover {
  background: #fffaf0;
  border-color: #f6bf6a;
}

.ov-fav:focus-visible {
  outline: 2px solid rgba(37, 99, 235, 0.55);
  outline-offset: 2px;
}

.ov-fav.is-empty .ov-fav-star,
.ov-fav.is-failed .ov-fav-star {
  color: #94a3b8;
}

.ov-fav-star {
  width: 13px;
  height: 13px;
  flex: none;
  color: #f59e0b;
  fill: currentColor;
}

.ov-fav b {
  height: 17px;
  min-width: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: #fef3c7;
  color: #b45309;
  font-size: 10.5px;
  font-weight: 700;
  display: inline-grid;
  place-items: center;
}

/* 弹层内部（外壳 padding/边框/阴影在下方 :global 里，因为 popper 被 teleport 到 body） */
.ov-fav-h {
  padding: 11px 14px 9px;
  border-bottom: 1px solid #eef3fa;
}

.ov-fav-h b {
  font-size: 12.5px;
  font-weight: 700;
  color: #1e293b;
}

.ov-fav-h span {
  display: block;
  margin-top: 2px;
  font-size: 10.5px;
  color: #8aa0bd;
}

.ov-fav-err {
  margin: 0;
  padding: 8px 14px;
  background: #fef2f2;
  border-bottom: 1px solid #fee2e2;
  color: #b91c1c;
  font-size: 10.5px;
}

.ov-fav-empty {
  padding: 18px 14px;
  text-align: center;
  font-size: 11px;
  color: #8aa0bd;
}

.ov-fav-empty-go {
  margin-top: 8px;
  padding: 0;
  border: 0;
  background: none;
  color: #2563eb;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.ov-fav-empty-go:hover {
  text-decoration: underline;
}

.ov-fav-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid #f4f8fd;
  background: #fff;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}

.ov-fav-row:hover {
  background: #f8fbff;
}

.ov-fav-row:focus-visible {
  outline: 2px solid rgba(37, 99, 235, 0.55);
  outline-offset: -2px;
}

.ov-fav-icon {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
}

.ov-fav-icon.site {
  background: #e8f1ff;
  color: #1d4ed8;
}

.ov-fav-icon.tbl {
  background: #ecfdf5;
  color: #047857;
}

.ov-fav-text {
  flex: 1;
  min-width: 0;
}

.ov-fav-text b {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: #1e293b;
}

.ov-fav-text span {
  display: block;
  font-size: 10.5px;
  color: #8aa0bd;
}

.ov-fav-skel {
  display: block;
  width: 62px;
  height: 8px;
  margin: 3px 0 2px;
  border-radius: 4px;
  background: linear-gradient(90deg, #eef3fa 0%, #e3ebf6 50%, #eef3fa 100%);
  animation: ov-fav-pulse 1.4s ease-in-out infinite;
}

@keyframes ov-fav-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

.ov-fav-n {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  font-size: 12px;
  font-weight: 700;
  color: #334155;
}

.ov-fav-n i {
  font-style: normal;
  font-size: 11px;
  color: #c3d2e5;
}

.ov-fav-f {
  padding: 9px 14px;
  background: #f8fbff;
  font-size: 10.5px;
  color: #8aa0bd;
}

/* 弹层外壳：弹层被 teleport 到 body，scoped 选择器够不到，只能走 :global */
:global(.ov-fav-popper.el-popover.el-popper) {
  padding: 0;
  border: 1px solid #dbe6f4;
  border-radius: 10px;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.06);
  overflow: hidden;
}

:global(.ov-fav-popper .el-popper__arrow::before) {
  border: 1px solid #dbe6f4;
  background: #fff;
}

@media (max-width: 720px) {
  :global(.ov-fav-popper.el-popover.el-popper) {
    max-width: calc(100vw - 24px);
  }
}
</style>