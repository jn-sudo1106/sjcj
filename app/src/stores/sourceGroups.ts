import { computed, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useAuthStore } from './auth'

// 'view'：源管理「我的视图」（2026-10-12）
export type DirectoryMode = 'system' | 'personal' | 'view'
export type DirectoryDefault = DirectoryMode | 'last'
export interface SourceGroup { id: string; name: string; parentId: string; sourceIds: string[] }
interface DirectoryState { version: 1; groups: SourceGroup[]; preference: DirectoryDefault; last: DirectoryMode }
const emptyState = (): DirectoryState => ({ version: 1, groups: [], preference: 'system', last: 'system' })

// 本机存储边界；只保存目录关系，不写 Source，也不参与数据权限判断。
export const sourceGroupStorageKey = (account: string) => `ce:source-directories:v1:${encodeURIComponent(account)}`
export function parseDirectoryState(raw: string | null): DirectoryState {
  if (!raw) return emptyState()
  const value = JSON.parse(raw) as DirectoryState
  if (value.version !== 1 || !Array.isArray(value.groups)
    || !['system', 'personal', 'view', 'last'].includes(value.preference)
    || !['system', 'personal', 'view'].includes(value.last)) throw new Error('源分组本机数据格式异常')
  const ids = new Set<string>()
  for (const g of value.groups) {
    if (!g || typeof g.id !== 'string' || !g.id || ids.has(g.id) || typeof g.name !== 'string'
      || !g.name.trim() || typeof g.parentId !== 'string' || !Array.isArray(g.sourceIds)
      || g.sourceIds.some(id => typeof id !== 'string' || !id.trim())) throw new Error('源分组本机数据格式异常')
    ids.add(g.id)
  }
  for (const g of value.groups) {
    if (g.parentId && (g.parentId === g.id || !value.groups.some(p => p.id === g.parentId && !p.parentId))) {
      throw new Error('源分组层级异常')
    }
  }
  return value
}

export const useSourceGroupsStore = defineStore('sourceGroups', () => {
  const auth = useAuthStore()
  const account = computed(() => auth.info?.id != null ? String(auth.info.id) : '')
  const state = ref<DirectoryState>(emptyState())
  const error = ref('')
  function reload() {
    state.value = emptyState()
    error.value = ''
    if (!account.value) return
    try { state.value = parseDirectoryState(localStorage.getItem(sourceGroupStorageKey(account.value))) }
    catch (e) { error.value = e instanceof Error ? e.message : '无法读取本机源分组' }
  }
  watch(account, reload, { immediate: true, flush: 'sync' })
  function onStorage(event: StorageEvent) {
    if (event.key === null || (account.value && event.key === sourceGroupStorageKey(account.value))) reload()
  }
  window.addEventListener('storage', onStorage)
  onScopeDispose(() => window.removeEventListener('storage', onStorage))

  function update(change: (next: DirectoryState) => void) {
    if (!account.value) throw new Error('请先加载当前账号信息')
    // 每次操作先读最新值，避免同账号多个标签页覆盖彼此已保存的修改。
    const next = parseDirectoryState(localStorage.getItem(sourceGroupStorageKey(account.value)))
    change(next)
    localStorage.setItem(sourceGroupStorageKey(account.value), JSON.stringify(next))
    state.value = next
    error.value = ''
  }
  function saveGroup(name: string, parentId = '', id?: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 40) throw new Error('分组名称需为 1–40 个字符')
    // 旧平台也运行在 HTTP 内网地址，那里 randomUUID 不可用；getRandomValues 不要求安全上下文。
    const groupId = id || `group-${Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('')}`
    update(next => {
      const existing = next.groups.find(g => g.id === id)
      if (id && !existing) throw new Error('分组已被删除，请刷新页面')
      if (parentId && (!next.groups.some(g => g.id === parentId && !g.parentId) || parentId === id
        || next.groups.some(g => g.parentId === id))) throw new Error('分组最多支持两级，含子分组的目录不能移到下级')
      if (next.groups.some(g => g.id !== id && g.parentId === parentId && g.name === trimmed)) throw new Error('同级分组名称不能重复')
      if (existing) Object.assign(existing, { name: trimmed, parentId })
      else next.groups.push({ id: groupId, name: trimmed, parentId, sourceIds: [] })
    })
    return groupId
  }
  function deleteGroup(id: string) {
    update(next => { next.groups = next.groups.filter(g => g.id !== id && g.parentId !== id) })
  }
  function assign(ids: string[], targets: string[], from?: string) {
    const members = [...new Set(ids.map(id => id.trim()).filter(Boolean))]
    update(next => {
      if (!targets.length || targets.some(id => !next.groups.some(g => g.id === id))) throw new Error('请选择有效的目标分组')
      if (from && targets.includes(from)) throw new Error('移动目标不能包含原分组')
      for (const g of next.groups) {
        if (targets.includes(g.id)) g.sourceIds = [...new Set([...g.sourceIds, ...members])]
        else if (g.id === from) g.sourceIds = g.sourceIds.filter(id => !members.includes(id))
      }
    })
  }
  function removeMembers(groupId: string, ids: string[]) {
    update(next => {
      const group = next.groups.find(g => g.id === groupId)
      if (!group) throw new Error('分组已被删除')
      group.sourceIds = group.sourceIds.filter(id => !ids.includes(id))
    })
  }
  function setPreference(preference: DirectoryDefault) { update(next => { next.preference = preference }) }
  function remember(mode: DirectoryMode) {
    if (account.value && state.value.last !== mode) update(next => { next.last = mode })
  }
  const groups = computed(() => state.value.groups)
  const preference = computed(() => state.value.preference)
  const defaultMode = computed(() => state.value.preference === 'last' ? state.value.last : state.value.preference)
  const options = computed(() => groups.value.filter(g => !g.parentId).flatMap(g => [
    { ...g, label: g.name }, ...groups.value.filter(c => c.parentId === g.id).map(c => ({ ...c, label: `${g.name} / ${c.name}` })),
  ]))
  return { account, groups, options, preference, defaultMode, error, saveGroup, deleteGroup, assign, removeMembers, setPreference, remember }
})
