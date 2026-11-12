<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { personalWorkbenchApi, WORKBENCH_TRUNCATED_NOTE, type WorkbenchItem, type WorkbenchAlarm, type ResourceKind } from '@/api/personalWorkbench'
import WbIcon from './WbIcon.vue'
import ModuleState from './ModuleState.vue'

defineOptions({ name: 'PersonalWorkbench' })
const auth = useAuthStore()
const router = useRouter()
type Module<T> = { list: T[]; total?: number; truncated?: boolean; loading: boolean; error: string; unavailable: boolean }
const moduleState = <T,>(): Module<T> => ({ list: [], loading: true, error: '', unavailable: false })
const collections = reactive(moduleState<WorkbenchItem>())
const recents = reactive(moduleState<WorkbenchItem>())
const alarms = reactive(moduleState<WorkbenchAlarm>())
const secondaryVisible = ref(true)
const recentDrawer = ref(false)
const favoritesEl = ref<HTMLElement>()
const selectedKind = ref<ResourceKind>('SITE')
const alertScope = ref<'open' | 'all'>('open')
const removing = ref(new Set<string>())
const updatedAt = ref('')
let epoch = 0
let disposed = false
const kinds: { key: ResourceKind; label: string; icon: string }[] = [
  { key: 'SITE', label: '网站', icon: 'globe' }, { key: 'SOURCE', label: '源', icon: 'database' }, { key: 'ENTRY_TYPE', label: '表', icon: 'table' },
]
const count = (m: { loading: boolean; error: string; total?: number }) => m.loading || m.error ? '—' : m.total ?? '—'
const favRows = computed(() => collections.list.filter(x => x.kind === selectedKind.value).slice(0, 4))
const alarmRows = computed(() => alarms.list.filter(x => alertScope.value === 'all' || x.level !== 'recover').slice(0, 5))
const unresolved = computed(() => alarms.error || alarms.loading ? '—' : alarms.list.filter(x => x.level !== 'recover').length)
const greeting = computed(() => { const hour = new Date().getHours(); return hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好' })
const stats = computed(() => [
  { label: '我的收藏', num: count(collections), note: collections.error ? '收藏暂不可用' : '当前可访问的收藏', icon: 'star', color: 'blue' },
  { label: '最近访问', num: count(recents), note: recents.error ? '访问记录暂不可用' : '最近访问的可见资源', icon: 'clock', color: 'cyan' },
  { label: '未恢复告警', num: unresolved.value, note: alarms.error ? '个人告警接口未就绪' : '与我相关的未恢复告警', icon: 'alert', color: 'red' },
])
const requests = new WeakMap<object, number>()
async function load<T>(state: Module<T>, getter: () => Promise<{ list: T[]; total?: number; truncated?: boolean }>, ticket: number) {
  const request = (requests.get(state) ?? 0) + 1
  requests.set(state, request)
  const isCurrent = () => !disposed && ticket === epoch && requests.get(state) === request
  state.loading = true; state.error = ''; state.unavailable = false
  try {
    const result = await getter()
    if (!isCurrent()) return
    state.list = result.list; state.total = result.total; state.truncated = result.truncated
  } catch (error) {
    if (!isCurrent()) return
    state.list = []; state.total = undefined; state.truncated = false
    state.error = error instanceof Error ? error.message : '请求失败，请稍后重试'
    state.unavailable = error instanceof Error && error.name === 'WorkbenchUnavailableError'
  } finally { if (isCurrent()) state.loading = false }
}
async function refresh() {
  const ticket = ++epoch
  await Promise.all([
    load(collections, () => personalWorkbenchApi.collections(), ticket),
    load(recents, () => personalWorkbenchApi.recents(), ticket),
    load(alarms, () => personalWorkbenchApi.alarms(), ticket),
  ])
  if (!disposed && ticket === epoch) updatedAt.value = new Date().toLocaleString('sv-SE').slice(0, 16)
}
function retry(key: 'collections' | 'recents' | 'alarms') {
  if (key === 'collections') void load(collections, () => personalWorkbenchApi.collections(), epoch)
  if (key === 'recents') void load(recents, () => personalWorkbenchApi.recents(), epoch)
  if (key === 'alarms') void load(alarms, () => personalWorkbenchApi.alarms(), epoch)
}
async function scrollFavorites() { secondaryVisible.value = true; await nextTick(); favoritesEl.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }
function openItem(item: WorkbenchItem) {
  if (item.kind === 'ENTRY_TYPE') { void router.push({ path: '/data', query: { tab: 'entry', entryTypeId: item.id } }); return }
  void router.push({ path: '/canvas', query: { ...(item.kind === 'SITE' ? { siteId: item.id, view: 'source' } : { sourceId: item.id, ...(item.siteId ? { siteId: item.siteId } : {}), view: 'overview' }), returnTo: '/workbench' } })
}
async function removeFavorite(item: WorkbenchItem) {
  const key = `${item.kind}:${item.id}`
  if (removing.value.has(key)) return
  const ticket = epoch
  removing.value = new Set([...removing.value, key])
  try {
    await personalWorkbenchApi.removeFavorite(item)
    if (disposed || ticket !== epoch) return
    collections.list = collections.list.filter(x => x.kind !== item.kind || x.id !== item.id)
    if (collections.total !== undefined) collections.total--
    ElMessage.success(`已取消收藏：${item.name}`)
  } catch (error) { if (!disposed && ticket === epoch) ElMessage.error(error instanceof Error ? error.message : '取消收藏失败') }
  finally { if (ticket === epoch) removing.value = new Set([...removing.value].filter(x => x !== key)) }
}
function dateText(at?: string) { return at ? at.slice(5, 16) : '—' }
watch(() => auth.cacheKey, () => {
  for (const state of [collections, recents, alarms]) { state.list = []; state.total = undefined; state.truncated = false }
  removing.value = new Set(); updatedAt.value = ''; secondaryVisible.value = true
  void refresh()
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; epoch++ })
</script>

<template>
  <div class="workbench">
    <div class="container">
      <section class="welcome">
        <div><div class="eyebrow">工作台概览</div><h1>{{ greeting }}，{{ auth.name || '用户' }}</h1>
          <p>集中查看你的收藏与最近访问，通过左侧菜单进入其他功能。</p>
        </div>
        <div class="wel-right"><div class="time">{{ updatedAt ? `最近刷新：${updatedAt}` : '正在加载工作台数据…' }}</div>
          <div class="actions"><router-link class="btn" to="/overview">← 返回资产总览</router-link><button class="btn btn-fav" type="button" @click="scrollFavorites"><WbIcon name="star" />我的收藏 {{ count(collections) }}</button><button class="btn" type="button" :disabled="collections.loading || recents.loading" @click="refresh"><WbIcon name="reload" />刷新</button><button class="btn" type="button" :aria-expanded="secondaryVisible" aria-controls="wb-secondary" @click="secondaryVisible = !secondaryVisible"><WbIcon name="sliders" />{{ secondaryVisible ? '隐藏内容' : '显示内容' }}</button></div>
        </div>
      </section>
      <div class="stats"><div v-for="stat in stats" :key="stat.label" class="stat"><div><div class="label">{{ stat.label }}</div><div class="num">{{ stat.num }}</div><div class="note">{{ stat.note }}</div></div><div class="s-icon" :class="stat.color"><WbIcon :name="stat.icon" /></div></div></div>
      <div class="section-caption"><div><h2>我的重点关注</h2><p>优先展示资源运行状态与需要处理的异常</p></div></div>
      <div class="cols focus-grid">
        <section class="panel"><div class="panel-head"><div class="panel-title"><h3>我的相关告警</h3><span class="count">{{ count(alarms) }}</span></div><div class="head-right"><div class="seg"><button type="button" :class="{ active: alertScope === 'open' }" @click="alertScope = 'open'">未恢复 ({{ unresolved }})</button><button type="button" :class="{ active: alertScope === 'all' }" @click="alertScope = 'all'">全部 ({{ count(alarms) }})</button></div></div></div>
          <ModuleState :loading="alarms.loading" :error="alarms.error" :empty="!alarmRows.length" :unavailable="alarms.unavailable" @retry="retry('alarms')"><template #empty>当前没有与我相关的{{ alertScope === 'open' ? '未恢复' : '' }}告警。</template>
            <div class="alert-body"><div v-for="item in alarmRows" :key="item.id" class="alert-row"><div class="alert-symbol" :class="{ green: item.level === 'recover' }"><WbIcon :name="item.level === 'recover' ? 'check' : 'alert'" /></div><div class="alert-content"><button class="alert-name text-button" type="button" @click="router.push({ path: '/monitor', query: { sourceId: item.sourceId } })">{{ item.name }}</button><div class="alert-desc" :title="item.description">{{ item.description }}</div></div><div class="alert-meta"><div class="alert-tag" :class="{ green: item.level === 'recover' }">{{ item.level === 'recover' ? '已恢复' : item.level === 'fail' ? '执行失败' : '数据异常' }}</div><div class="alert-time">{{ dateText(item.at) }}</div></div></div></div>
          </ModuleState>
          <div class="alert-footer"><span>{{ alarms.error ? '个人告警数据尚不可用' : '以最近一次成功查询为准' }}</span><router-link to="/monitor">进入监控中心 ›</router-link></div>
        </section>
      </div>
      <div v-show="secondaryVisible" id="wb-secondary"><div class="section-caption"><div><h2>常用内容</h2><p>收藏与最近访问独立整理，需要时快速进入</p></div></div>
        <div class="cols bottom-grid"><section ref="favoritesEl" class="panel"><div class="panel-head"><div class="panel-title"><h3>我的收藏</h3><span class="count">{{ count(collections) }}</span></div><div class="head-right"><div class="tabs"><button v-for="kind in kinds" :key="kind.key" type="button" :class="{ active: selectedKind === kind.key }" :aria-pressed="selectedKind === kind.key" @click="selectedKind = kind.key">{{ kind.label }} ({{ collections.loading || collections.error ? '—' : collections.list.filter(x => x.kind === kind.key).length }})</button></div><router-link :to="selectedKind === 'ENTRY_TYPE' ? '/data?tab=entry&fav=1' : '/collect?tab=favorite'">查看更多 ›</router-link></div></div>
          <ModuleState :loading="collections.loading" :error="collections.error" :empty="!favRows.length" @retry="retry('collections')"><template #empty>暂无此类可访问的收藏，可在资产列表点击星标收藏。</template>
            <div class="favorites-body"><div v-for="item in favRows" :key="`${item.kind}:${item.id}`" class="fav-row"><button class="fav-left text-button" type="button" @click="openItem(item)"><span class="site-mark"><WbIcon :name="kinds.find(x => x.key === item.kind)?.icon || 'globe'" /></span><span class="truncate"><span class="fav-name" :title="item.name">{{ item.name }}</span><span class="fav-url">{{ item.subtitle || '—' }}</span></span></button><div class="fav-right"><span>{{ dateText(item.at) }}</span><button class="star" type="button" :disabled="removing.has(`${item.kind}:${item.id}`)" :aria-label="`取消收藏：${item.name}`" @click="removeFavorite(item)"><WbIcon name="star" /></button></div></div></div>
          </ModuleState>
        </section>
        <section class="panel"><div class="panel-head"><div class="panel-title"><h3>最近访问</h3><span class="count">{{ count(recents) }}</span></div><div class="head-right"><button class="open" type="button" @click="recentDrawer = true">查看更多 ›</button></div></div>
          <ModuleState :loading="recents.loading" :error="recents.error" :empty="!recents.list.length" @retry="retry('recents')"><template #empty>打开网站、源或数据表后，可在这里快速返回。</template>
            <button v-for="item in recents.list.slice(0, 5)" :key="`${item.kind}:${item.id}`" class="visit-row text-button" type="button" @click="openItem(item)"><span class="visit-dot" :class="{ cyan: item.kind === 'SOURCE', purple: item.kind === 'ENTRY_TYPE' }" /><span class="visit-main"><span class="visit-name" :title="item.name">{{ item.name }}</span><span class="visit-info">{{ kinds.find(x => x.key === item.kind)?.label }} · {{ item.subtitle || '—' }}</span></span><span class="visit-time">{{ dateText(item.at) }}</span></button>
          </ModuleState>
        </section></div>
      </div>
      <p v-if="collections.truncated || recents.truncated" class="footer" role="status">{{ WORKBENCH_TRUNCATED_NOTE }}</p>
      <footer class="footer">智能采集中心 · 我的工作台</footer>
    </div>
    <el-drawer v-model="recentDrawer" title="最近访问" size="min(560px, 94vw)" append-to-body><button v-for="item in recents.list" :key="`${item.kind}:${item.id}`" class="visit-row text-button" type="button" @click="openItem(item)"><span class="visit-main"><span class="visit-name">{{ item.name }}</span><span class="visit-info">{{ item.subtitle }}</span></span><span class="visit-time">{{ dateText(item.at) }}</span></button></el-drawer>
  </div>
</template>
<style scoped src="./workbench.css"></style>
<style scoped>
.welcome{flex-wrap:wrap;gap:20px}.stats{grid-template-columns:repeat(3,minmax(0,1fr))}.focus-grid{grid-template-columns:minmax(0,1fr)}.actions .btn{text-decoration:none}.text-button{border:0;background:transparent;padding:0;text-align:left;color:inherit;font:inherit;cursor:pointer}.visit-row.text-button{width:calc(100% - 46px)}.fav-left.text-button{flex:1}.truncate{min-width:0;overflow:hidden}.fav-name,.fav-url,.visit-name,.visit-info{display:block}.fav-name,.fav-url,.visit-name,.res-name,.res-under{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.btn:disabled,.star:disabled{opacity:.5;cursor:wait}button:focus-visible,a:focus-visible{outline:2px solid #2563eb;outline-offset:3px}.panel-title,.head-right{min-width:0}.panel-title h3{white-space:nowrap}@media(max-width:1180px){.cols{grid-template-columns:1fr}.welcome{gap:20px;flex-wrap:wrap}.wel-right{align-items:flex-start}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.container{padding:16px}.welcome{padding:20px}.welcome h1{font-size:22px}.actions{flex-wrap:wrap}.panel-head{padding:12px 16px;gap:12px;flex-wrap:wrap}.panel-sub{display:none}.table-h,.res-row{grid-template-columns:minmax(90px,1fr) 68px 90px 42px}.table-h>div:nth-child(4),.res-row>.abnormal{display:none}.stat{padding:16px}.s-icon{width:38px;height:38px}.stat .num{font-size:28px}.head-right{gap:10px}.tabs button{padding:7px}.visit-row.text-button{width:calc(100% - 34px)}}
</style>
