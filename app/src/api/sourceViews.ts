/**
 * 源管理「我的视图」存取（2026-10-12，方案 `设计稿/设计方案/1012-我的视图_开发设计方案_2026-10-12.md` §6）。
 *
 * 后端 `source-view/list|add|update|delete` 还没有，**先存浏览器本地**（按用户 ID 分 key），页面上标「暂存本机」。
 * 方法签名、校验（名称 1–40 字且不重名、每人最多 50 个、revision 并发保护、只能一个默认）都按给后端的接口约定写，
 * 后端就绪后只换这个文件的实现：userId 由后端从会话取，届时去掉 userId 参数即可。
 */
import type { SourceListViewState } from '@/views/FlowCanvas/result/sourceListViewState'

export interface SourceView {
  viewId: string
  viewName: string
  state: SourceListViewState
  isDefault: boolean
  revision: number
  createdAt: string
  updatedAt: string
}

export const SOURCE_VIEW_LIMIT = 50
export const SOURCE_VIEW_NAME_MAX = 40

export const sourceViewStorageKey = (userId: string) => `ce:source-views:v1:${encodeURIComponent(userId)}`

function read(userId: string): SourceView[] {
  const raw = localStorage.getItem(sourceViewStorageKey(userId))
  if (!raw) return []
  const data = JSON.parse(raw) as { version?: number; views?: SourceView[] }
  if (data?.version !== 1 || !Array.isArray(data.views)) throw new Error('本机视图数据格式异常')
  return data.views
}
function write(userId: string, views: SourceView[]) {
  localStorage.setItem(sourceViewStorageKey(userId), JSON.stringify({ version: 1, views }))
}
function requireUser(userId: string) {
  if (!userId) throw new Error('请先加载当前账号信息')
}
function checkName(views: SourceView[], name: string, selfId?: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > SOURCE_VIEW_NAME_MAX) throw new Error(`视图名称需为 1–${SOURCE_VIEW_NAME_MAX} 个字`)
  if (views.some((v) => v.viewId !== selfId && v.viewName === trimmed)) throw new Error(`已有同名视图「${trimmed}」`)
  return trimmed
}
function find(views: SourceView[], viewId: string, revision: number): SourceView {
  const view = views.find((v) => v.viewId === viewId)
  if (!view) throw new Error('视图已被删除，请刷新后重试')
  if (view.revision !== revision) throw new Error('视图已变化，请刷新后重试')
  return view
}
const now = () => new Date().toISOString()
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export const sourceViewApi = {
  /** 当前用户的全部视图（按创建先后） */
  list: async (userId: string): Promise<SourceView[]> => {
    requireUser(userId)
    return read(userId)
  },
  add: async (userId: string, input: { viewName: string; state: SourceListViewState; isDefault?: boolean }): Promise<SourceView> => {
    requireUser(userId)
    const views = read(userId)
    if (views.length >= SOURCE_VIEW_LIMIT) throw new Error(`每人最多 ${SOURCE_VIEW_LIMIT} 个视图，请先删除不用的视图`)
    const viewName = checkName(views, input.viewName)
    const id = `view-${Array.from(crypto.getRandomValues(new Uint32Array(2)), (n) => n.toString(16).padStart(8, '0')).join('')}`
    const view: SourceView = { viewId: id, viewName, state: clone(input.state), isDefault: !!input.isDefault, revision: 1, createdAt: now(), updatedAt: now() }
    if (view.isDefault) views.forEach((v) => { if (v.isDefault) { v.isDefault = false; v.revision += 1 } })
    write(userId, [...views, view])
    return view
  },
  /** 保存 / 重命名 / 设为默认（只改传了的字段）；revision 不一致时报「视图已变化」 */
  update: async (userId: string, input: { viewId: string; revision: number; viewName?: string; state?: SourceListViewState; isDefault?: boolean }): Promise<SourceView> => {
    requireUser(userId)
    const views = read(userId)
    const view = find(views, input.viewId, input.revision)
    if (input.viewName != null) view.viewName = checkName(views, input.viewName, view.viewId)
    if (input.state) view.state = clone(input.state)
    if (input.isDefault != null) {
      if (input.isDefault) views.forEach((v) => { if (v !== view && v.isDefault) { v.isDefault = false; v.revision += 1 } })
      view.isDefault = input.isDefault
    }
    view.revision += 1
    view.updatedAt = now()
    write(userId, views)
    return view
  },
  remove: async (userId: string, input: { viewId: string; revision: number }): Promise<void> => {
    requireUser(userId)
    const views = read(userId)
    find(views, input.viewId, input.revision)
    write(userId, views.filter((v) => v.viewId !== input.viewId))
  },
}
