<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SourceTab from './SourceTab.vue'
import ConfigTab from './ConfigTab.vue'
import PersonalSources from './PersonalSources.vue'
import { ElMessage } from 'element-plus'
import { useSourceGroupsStore, type DirectoryDefault } from '@/stores/sourceGroups'
defineOptions({ name: 'CollectAssets' })
const directories = useSourceGroupsStore()

// 旧「配置列表」入口保持隐藏。最新口径把流程与节点配置拆开管理，旧 configPaged 只覆盖
// 节点配置的一部分，不能直接作为新的配置中心。ConfigTab 组件暂不删，留作旧数据只读排查。
//
// 「表 ID 列表」2026-09-19 迁到数据中心（/data?tab=entry）——表结构属于"数据"那条线，
// 这里管的是网站与源。**tab 条先保留**（虽然只剩一项）。
// 1008-03「来源组」2026-10-13 移到系统设置（Settings）——平台配置性质，不属于日常浏览入口。
const TABS: { key: string; label: string }[] = [
  { key: 'source', label: '系统目录' },
  { key: 'personal', label: '我的分组' },
  // 0917-17：收藏做成一个 tab 而不是工具条上的开关（2026-09-21 用户定）——
  // 会上原话是「我放在这个地方，我关注的网站也行」（措辞后来统一成"收藏"）。
  // 做成 tab 还白得一条能存书签的地址 `/collect?tab=favorite`，刷新、发给别人都还在。
  // 0924-01：改名「我的收藏」——源列表视图（0924-08）下这里列的是收藏的**源**，叫"网站"就不准了。
  { key: 'favorite', label: '我的收藏' },
  // 0924-01：原先挂在排序下拉里的「最近打开」提成 tab，与收藏并列。
  { key: 'recent', label: '最近打开' },
]
// 收藏 / 最近打开都复用 SourceTab，由 scope 锁定过滤（见下方 :scope）
const comps: Record<string, Component> = { source: SourceTab, personal: PersonalSources, config: ConfigTab, favorite: SourceTab, recent: SourceTab }
const SCOPES: Record<string, 'all' | 'favorite' | 'recent'> = { source: 'all', favorite: 'favorite', recent: 'recent' }
const route = useRoute()
const router = useRouter()
const validTabs = new Set(TABS.map((tab) => tab.key))
const active = ref('source')
function normalizeTab(tab: unknown): string {
  const key = String(tab ?? '')
  return validTabs.has(key) ? key : 'source'
}
// 参数模块迁到规则资产；旧“流程模板”链接统一收口到流程中心。
watch(() => [route.query.tab, directories.account, directories.defaultMode, route.path, route.query.state, route.query.category], ([tab]) => {
  if (route.path !== '/collect') return
  if (tab === 'template') {
    void router.replace('/flows')
    return
  }
  if (tab === 'param') {
    void router.replace('/rules?tab=param')
    return
  }
  // 表 ID 列表 2026-09-19 迁到数据中心；旧书签/旧链接照样能用
  if (tab === 'entry') {
    void router.replace('/data?tab=entry')
    return
  }
  const systemDeepLink = route.query.state != null || route.query.category != null
  active.value = tab == null
    ? (!systemDeepLink && directories.defaultMode === 'personal' ? 'personal' : 'source')
    : normalizeTab(tab)
  if (active.value === 'personal' || active.value === 'source') {
    try { directories.remember(active.value === 'personal' ? 'personal' : 'system') }
    catch (e) { ElMessage.error(e instanceof Error ? e.message : '无法保存目录偏好') }
  }
}, { immediate: true })
function selectTab(key: string) {
  const tab = normalizeTab(key)
  const query = { tab }
  void router.replace({ path: '/collect', query })
}
function changePreference(event: Event) {
  try { directories.setPreference((event.target as HTMLSelectElement).value as DirectoryDefault) }
  catch (e) { ElMessage.error(e instanceof Error ? e.message : '本机保存失败') }
}
</script>

<template>
  <div class="ca-page-wrap">
    <div class="ca-tabs-wrap">
      <div class="ca-tabs-inner">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="ca-tab-link"
          :class="{ active: active === t.key }"
          @click="selectTab(t.key)"
        >
          {{ t.label }}
        </button>
      </div>
      <label class="ca-default" title="默认目录偏好仅保存于当前账号、当前浏览器">默认进入（本机）
        <select :value="directories.preference" :disabled="!directories.account" aria-label="默认目录" @change="changePreference">
          <option value="system">系统目录</option><option value="personal">我的分组</option><option value="last">上次使用的目录</option>
        </select>
      </label>
    </div>
    <el-alert v-if="directories.error" :title="directories.error" type="error" :closable="false" />
    <div class="ca-content">
      <transition name="fade-slide" mode="out-in">
        <KeepAlive>
          <component :is="comps[active]" :key="`${directories.account}:${active}`" :scope="SCOPES[active]" />
        </KeepAlive>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.ca-page-wrap { display: flex; flex-direction: column; gap: 12px; height: 100%; }
.ca-tabs-wrap { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.ca-default { display: flex; align-items: center; gap: 8px; color: var(--rc-muted); font-size: 12px; }
.ca-default select { border: 1px solid var(--rc-border-soft); border-radius: 6px; background: #fff; padding: 6px 8px; color: var(--rc-text); }
.ca-content { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.ca-tabs-inner {
  display: inline-flex;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 10px;
  gap: 4px;
}
.ca-tab-link {
  border: 0;
  background: transparent;
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.ca-tab-link:hover { color: #0f172a; }
.ca-tab-link.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fade-slide-enter-from { opacity: 0; transform: translateY(8px); }
.fade-slide-leave-to { opacity: 0; transform: translateY(-8px); }
</style>
