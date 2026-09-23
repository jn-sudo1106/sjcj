<script setup lang="ts">
import { ref } from 'vue'
import { Search, Grid, List, Plus, Refresh, Setting } from '@element-plus/icons-vue'
import { sourceApi, type SourceCategory } from '@/api'

const props = defineProps<{
  keyword: string
  categoryFilter: string[]
  tagFilter: string
  stateFilter: string
  sortBy: 'updated' | 'name'
  categories: SourceCategory[]
  allTags: string[]
  total: number
  /** `total` 是**源**总数、`siteTotal` 是全站网站数（历史命名，见 SourceTab 的说明）。
   *  除 siteTotal 外都是**当前筛选命中网站**的汇总（2026-09-23 起） */
  stats: { total: number; error: number; notify: number; siteTotal?: number }
  /** 当前是否带着筛选条件：决定「网站」这个数要不要写成「命中 / 全站」 */
  filtered?: boolean
  view: 'card' | 'table'
  /** 只看收藏（0917-17）。收藏的网站**恒排最前**，这个开关是"把其余的藏起来"。
   *  可选：调用方不给就是关着，既有测试不必为它改动。 */
  favOnly?: boolean
  /** 已收藏数量，显示在选项上——0 的时候选了会空一片，得让人知道 */
  favCount?: number
  /** 在「我收藏的网站」tab 里：这一页恒定只看收藏，下拉里就不该再出现这一项 */
  favLocked?: boolean
  /** 只看最近打开（0917-17 后半条），与 favOnly 互斥 */
  recentOnly?: boolean
  /** 最近打开过几个网站——一个都没有时这一项点了会空一片，得让人知道 */
  recentCount?: number
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:categoryFilter': [value: string[]]
  'update:tagFilter': [value: string]
  'update:stateFilter': [value: string]
  'update:sortBy': [value: 'updated' | 'name']
  'setView': [value: 'card' | 'table']
  'update:favOnly': [value: boolean]
  'update:recentOnly': [value: boolean]
  'filterChange': []
  'refresh': []
  /** 新建网站（2026-09-18）：对象级操作，与顶栏那个全局的「新建采集」分层 */
  'createSite': []
  /** 管理分类（2026-09-21）：在全部分类下拉底部触发分类管理抽屉 */
  'openCategoryManager': []
}>()

const treeSelectRef = ref()

function onOpenCategoryManager() {
  treeSelectRef.value?.blur?.()
  emit('openCategoryManager')
}

function onKeywordInput(value: string) {
  emit('update:keyword', value)
}

/**
 * 排序下拉三选一：最近修改 / 名称 / 只看收藏。
 * 前两项是排序，第三项是过滤——选它时保留当前 sortBy，这样从「只看收藏」切回来
 * 还是原来那个排序，不会被悄悄重置。
 */
function onPickSort(v: 'updated' | 'name' | 'favorite' | 'recent') {
  // 「只看收藏」与「最近打开」是两种过滤模式，互斥；选回前两项就都关掉
  if (v === 'favorite') {
    if (props.recentOnly) emit('update:recentOnly', false)
    emit('update:favOnly', true)
  } else if (v === 'recent') {
    if (props.favOnly) emit('update:favOnly', false)
    emit('update:recentOnly', true)
  } else {
    if (props.favOnly) emit('update:favOnly', false)
    if (props.recentOnly) emit('update:recentOnly', false)
    emit('update:sortBy', v)
  }
  emit('filterChange')
}

// 分类筛选是树形多选（旧平台目录树勾选语义；选中值是目录 ID 数组，空数组 = 全部）。
// 清空/异常值回传 []，与旧筛选值口径一致。
function onCategoryChange(value: unknown) {
  const ids = Array.isArray(value) ? value.map((v) => String(v)) : []
  emit('update:categoryFilter', ids)
  emit('filterChange')
}

// 旧分类接口首屏只返回根节点；树节点展开时按 parentId 懒加载子级。
// 与 MoreSourcesDialog 的分类树同一加载口径：children 已在数据里时直接用，避免重复请求。
async function loadCategoryChildren(
  node: { level: number; data: SourceCategory },
  resolve: (nodes: SourceCategory[]) => void,
) {
  if (node.level === 0) {
    resolve(props.categories)
    return
  }
  if (node.data.children?.length) {
    resolve(node.data.children)
    return
  }
  try {
    resolve(await sourceApi.sourceCategories(node.data.id))
  } catch {
    resolve([])
  }
}
</script>

<template>
  <div class="ca-toolbar">
    <!-- 「新增网站」放最左（2026-09-18）：这是本页的主动作，对齐旧平台 SiteList 操作栏的
         「＋新增网站」。不放右边、也不并进顶栏——顶栏的「新建采集」是总览页也挂着的全局入口，
         两者层级不同。
         **只留图标**（2026-09-18 走查）：带文字要 99px，把右侧的统计与视图切换挤到换行
         （「卡片」「表格」两个字被压成上下两行）。这一行本来就装不下，按钮不该是压垮它的
         那一个——图标 34px，名字交给 tooltip。 -->
    <el-tooltip content="新增网站" placement="bottom" :show-after="120">
      <button class="ca-new-site" type="button" data-testid="site-create" aria-label="新增网站" @click="emit('createSite')">
        <el-icon :size="14"><Plus /></el-icon>
      </button>
    </el-tooltip>
    <el-input
      :model-value="keyword"
      :prefix-icon="Search"
      clearable
      placeholder="搜索网站名 / 源名"
      class="ca-search"
      @input="onKeywordInput"
    />
    <!-- 分类树：多级目录按需展开（首屏根节点 + 一层子级由列表页预取，更深层级展开时懒加载）。
         多选复选框用 Element Plus 标准样式（与表格选择列等全站 checkbox 一致，主题色由全局
         tokens 统一）；check-strictly 让父子独立勾选——子级是懒加载的，级联勾选会把未加载的
         孙级 ID 漏出 categoryIds，后端 IN 匹配会漏数据。 -->
    <el-tree-select
      ref="treeSelectRef"
      :model-value="categoryFilter"
      placeholder="全部分类"
      class="ca-category"
      popper-class="ca-category-popper"
      clearable
      multiple
      collapse-tags
      collapse-tags-tooltip
      :max-collapse-tags="1"
      check-strictly
      :data="categories"
      :props="{ label: 'name', children: 'children' }"
      node-key="id"
      lazy
      :load="loadCategoryChildren"
      @update:model-value="onCategoryChange"
    >
      <template #default="{ data }">
        <span class="ca-category-node">
          <span>{{ data.name }}</span>
          <span v-if="data.count != null" class="ca-category-count">{{ data.count }}</span>
        </span>
      </template>
      <template #footer>
        <div class="ca-category-dropdown-footer">
          <span class="ca-category-footer-label">维护分类</span>
          <el-button
            link
            type="primary"
            size="small"
            :icon="Setting"
            class="ca-category-manage-btn"
            @click="onOpenCategoryManager"
          >
            管理分类
          </el-button>
        </div>
      </template>
    </el-tree-select>
    <el-select :model-value="tagFilter" placeholder="全部标签" style="width: 130px" clearable @update:model-value="(v: string) => { emit('update:tagFilter', v); emit('filterChange') }">
      <el-option label="全部标签" value="" />
      <el-option v-for="t in allTags" :key="t" :label="t" :value="t" />
    </el-select>
    <el-select :model-value="stateFilter" placeholder="全部状态" style="width: 130px" clearable @update:model-value="(v: string) => { emit('update:stateFilter', v); emit('filterChange') }">
      <el-option label="全部状态" value="all" />
      <el-option label="有异常源" value="error" />
    </el-select>
    <!-- 排序同样要 emit filterChange：少了它，改排序只更新 sortBy、列表不重新加载，
         下拉框变了而卡片顺序纹丝不动（旁边标签/状态两个 select 一直是这么配的，这里原先漏了）。 -->
    <!-- 「只看收藏」并在这个下拉里（2026-09-21 用户定）。它是过滤不是排序，所以：
         选中它时**不动 sortBy**，组内仍按上一次选的「最近修改 / 名称」排；
         选回那两项就把过滤关掉。在「我收藏的网站」tab 里（favLocked）不出现这一项，
         选中值也要退回 sortBy——否则下拉找不到 'favorite' 那个 option，会把原始值秃着显示出来。 -->
    <el-select
      :model-value="favOnly && !favLocked ? 'favorite' : recentOnly ? 'recent' : sortBy"
      style="width: 128px"
      data-testid="site-sort"
      @update:model-value="onPickSort"
    >
      <el-option label="最近修改" value="updated" />
      <el-option label="名称" value="name" />
      <el-option v-if="!favLocked" :label="favCount ? `只看收藏 (${favCount})` : '只看收藏'" value="favorite" />
      <!-- 最近打开：收藏要事先标记，而"找半天"那次根本没先收藏过——这一项补的是那一半。
           在「我收藏的网站」tab 里同样不出现，那个 tab 的语义就是收藏。 -->
      <el-option v-if="!favLocked" :label="recentCount ? `最近打开 (${recentCount})` : '最近打开'" value="recent" />
    </el-select>
    <!-- 四项都跟筛选走（2026-09-23 起，后端补齐了每个网站的聚合列，由 SourceTab 对命中列表求和）。
         此前后三项是全站汇总、不随筛选变，被当成"条数没更新"（2026-09-21 用户报）。 -->
    <div class="ca-stats">
      <el-tag
        type="info"
        effect="plain"
        class="stat-tag"
        :title="filtered && stats.siteTotal ? `当前筛选命中 ${total} 个，全站 ${stats.siteTotal} 个` : '全站网站数'"
      >网站 <b>{{ total }}</b><template v-if="filtered && stats.siteTotal"> / {{ stats.siteTotal }}</template></el-tag>
      <el-tag type="info" effect="plain" class="stat-tag" :title="filtered ? '当前筛选命中网站下的源数' : '全部网站下的源数'">源 <b>{{ stats.total }}</b></el-tag>
      <el-tag v-if="stats.error > 0" type="danger" class="stat-tag" :title="filtered ? '当前筛选命中网站下的出错源数' : '全部网站下的出错源数'">出错源 <b>{{ stats.error }}</b></el-tag>
      <el-tag v-if="stats.notify > 0" type="warning" class="stat-tag" :title="filtered ? '当前筛选命中的网站里，有告警源的网站数' : '有告警源的网站数'">告警网站 <b>{{ stats.notify }}</b></el-tag>
    </div>
    <span class="ca-spacer" />
    <!-- 视图切换同样只留图标（2026-09-18 走查）：带文字要 136px，是这一行里仅次于搜索框和
         统计区的第三大件，而"卡片/表格"两个图标本身已经说明了区别。 -->
    <div class="ca-view-toggle">
      <el-tooltip content="卡片视图" placement="bottom" :show-after="120">
        <button class="ca-view-btn" :class="{ active: view === 'card' }" type="button" aria-label="卡片视图" @click="emit('setView', 'card')"><el-icon :size="15"><Grid /></el-icon></button>
      </el-tooltip>
      <el-tooltip content="表格视图" placement="bottom" :show-after="120">
        <button class="ca-view-btn" :class="{ active: view === 'table' }" type="button" aria-label="表格视图" @click="emit('setView', 'table')"><el-icon :size="15"><List /></el-icon></button>
      </el-tooltip>
    </div>
    <button class="ca-refresh" type="button" title="刷新" @click="emit('refresh')"><el-icon :size="14"><Refresh /></el-icon></button>
  </div>
</template>

<style scoped>
/* 单行不换行（2026-09-18 定）。曾短暂改成 `wrap`，但换行后视图切换和刷新掉到第二行，
   用户明确要求"还是在一排"。
   一排要放得下，靠的是两件事：① 三个按钮区（新增 / 视图切换 / 刷新）都图标化并 `flex: none`；
   ② 其余控件给 `min-width` 而不是固定宽——压缩有下限，不会再被压成「全⌄」那样不可读。
   压缩顺序：搜索框先让（130px 下限），筛选下拉守到 110px（1280 实测 98px 会把「全部标签」
   截成「全部标...」，110 才读得全），三个图标按钮与统计区永不压缩。
   注意底部还有一条既有的 `@media (max-width: 1240px)`：更窄时仍旧换行、统计独占一行——
   那是原设计的窄屏兜底，本次没动它，所以"一排"的适用范围是 ≥1240。 */
.ca-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 12px;
  background: #fff;
  border: 1px solid var(--rc-border);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
}
/* 30×30，与视图切换里的按钮同高（`.ca-view-btn` 也是 30）——比 34 的输入框/刷新矮一档，
   在这排控件里显得收敛些；1px 边框、6px 圆角沿用 `.ca-refresh` 那套语汇，用蓝色说明它是主动作。
   **不用实心 primary**：#2563eb 的实心块在这排浅色控件里太跳，而且这一行已经有一个实心蓝的
   「新建采集」在顶栏；浅底 + 蓝图标既能区分主次，又不会把视线从列表上拽走。
   hover 才加深到浅蓝底 + 深蓝描边，对齐 tokens.css 里 `.rc-btn:hover` 的做法。 */
.ca-new-site {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0;
  border: 1px solid #d5e2f2; border-radius: 6px; background: #fff;
  color: var(--rc-primary); cursor: pointer;
  transition: border-color .12s, background .12s, color .12s;
}
.ca-new-site:hover { border-color: #bfdbfe; background: var(--rc-primary-bg); color: var(--rc-primary-ink); }
.ca-new-site:active { background: #e0ecfd; }
/* 搜索框是唯一的"减压阀"：其余控件都 flex:none 或有 110px 下限，放不下时全靠它让。
   下限 130px —— 1280 视口下实测整行刚好放得下（可用 1031px，其余合计 891px）；
   再高一点（150）会把最右的刷新按钮挤出可视区。 */
.ca-search { width: 250px; flex: 0 1 250px; min-width: 130px; }
/* 标签 / 状态 / 排序：inline style 只给了 width，flex 基准是 auto，窄屏会被压到「全⌄」
   （1280 实测 58px）。留出收缩余地但守住 96px —— 12px 字体下「全部标签 ⌄」刚好能读全。 */
.ca-toolbar > :deep(.el-select) { flex: 0 1 auto; min-width: 110px; }
/* 分类树是多选、标签可能折叠成 “+N”，比其余下拉更需要宽度，给它高一点的下限 */
.ca-category { min-width: 120px; }
.ca-search :deep(.el-input__wrapper) { border-radius: 6px; min-height: 34px; box-shadow: 0 0 0 1px var(--rc-border) inset; }
.ca-search :deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px #bfdbfe inset; }
.ca-category { width: 150px; flex: 0 0 150px; }
.ca-category-node { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.ca-category-count { color: var(--rc-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.ca-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  white-space: nowrap;
}
/* 统计区收紧左右内边距（1280 实测原 259px），省下的宽度留给筛选下拉。
   **不让它参与压缩**：数字被裁出来的是「出」这种半个词，比搜索框 placeholder 截断难看得多，
   所以 flex: none，压缩配额全部由搜索框承担（它有 150px 下限兜底）。 */
.stat-tag { font-size: 12px; }
.ca-stats :deep(.el-tag) { padding: 0 6px; }
.stat-tag b { font-weight: 800; font-size: 13px; margin-left: 3px; }
.ca-spacer { flex: 1; min-width: 12px; }

.ca-view-toggle {
  display: inline-flex;
  gap: 0;
  padding: 2px;
  border: 1px solid var(--rc-border);
  border-radius: 7px;
  background: #f8fafc;
}
.ca-view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--rc-text-2);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.ca-view-btn:hover { color: var(--rc-primary-ink); }
.ca-view-btn.active { color: var(--rc-primary); font-weight: 700; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06); }
.ca-refresh {
  width: 34px;
  height: 34px;
  border: 1px solid var(--rc-border);
  border-radius: 6px;
  background: #fff;
  color: var(--rc-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ca-refresh:hover { border-color: #bfdbfe; color: var(--rc-primary); }

@media (max-width: 1240px) {
  .ca-toolbar { flex-wrap: wrap; }
  .ca-search { flex: 1 1 260px; width: auto; }
  .ca-stats { order: 2; flex: 1 1 100%; }
  .ca-stats span:first-child { padding-left: 0; }
}
</style>

<style>
/* 分类树下拉面板 teleport 到 body，无法 scoped；输入框 150px 放不下多级缩进，
   面板单独放宽（13.6 寸基准，不覆盖页面）。 */
.ca-category-popper { min-width: 248px; }
.ca-category-dropdown-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-top: 1px solid #f1f5f9;
  background-color: #f8fafc;
}
.ca-category-footer-label {
  font-size: 11px;
  color: #94a3b8;
}
.ca-category-manage-btn {
  font-size: 12px;
  font-weight: 600;
}
</style>
