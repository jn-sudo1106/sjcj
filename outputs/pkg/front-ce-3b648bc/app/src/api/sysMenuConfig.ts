import { request } from './client'
import type { Ack } from './types'

export interface SysMenuTreeNode {
  id: number
  parentId: number
  label: string
  modelCode?: string
  linkAddress?: string
  level?: number
  /** 0-目录(DIR), 1-菜单(MENU), 2-页内标签(TAB), 3-按钮(BUTTON) */
  type: number
  icon?: string
  order: number
  status: number
  remark?: string
  /** 前端组件文件路径 (如 views/Overview/index.vue) */
  componentPath?: string
  /** 路由唯一英文名 (Vue Router name) */
  routeName?: string
  /** 自动更新时间 (如 2026-11-05 21:05:37) */
  updateTime?: string
  children?: SysMenuTreeNode[]
}

export interface SysMenuForm {
  id?: number
  parentId: number
  name: string
  type: number
  linkAddress?: string
  modelCode?: string
  icon?: string
  order?: number
  status?: number
  remark?: string
  /** 前端组件文件路径 (如 views/Overview/index.vue) */
  componentPath?: string
  /** 路由唯一英文名 (如 Overview) */
  routeName?: string
}

export interface CleanLegacyData {
  updatedCount: number
  message: string
}

export interface SysMenuSortItem {
  id: number
  parentId?: number
  order: number
}

const EP = {
  tree: 'sys/menu/tree',
  save: 'sys/menu/save',
  sort: 'sys/menu/sort',
  delete: 'sys/menu/delete',
  cleanLegacy: 'sys/menu/clean-legacy',
} as const

/**
 * 获取系统全量菜单与资源树
 */
export async function getMenuTree(): Promise<SysMenuTreeNode[]> {
  const res = await request<SysMenuTreeNode[] | { data: SysMenuTreeNode[] }>(EP.tree, {}, { method: 'GET' })
  if (Array.isArray(res)) return res
  return (res as { data?: SysMenuTreeNode[] }).data || []
}

/**
 * 新增或更新菜单/资源
 */
export async function saveMenu(form: SysMenuForm): Promise<void> {
  await request<Ack>(EP.save, form as unknown as Record<string, unknown>, { method: 'POST' })
}

/**
 * 批量更新菜单排序与层级归属 (供拖拽与快捷调序使用)
 */
export async function updateMenuSort(items: SysMenuSortItem[]): Promise<void> {
  await request<Ack>(EP.sort, items as unknown as Record<string, unknown>, { method: 'POST' })
}

/**
 * 删除菜单及其子项
 *
 * 这里不能再传参数化的 httpEndpoint：client 的 live 判定优先取 httpEndpoint，
 * 动态路径不在 LIVE_ENDPOINTS 清单里会被 mock 接管（点了删除只改内存、库不动）。
 */
export async function deleteMenu(id: number): Promise<void> {
  await request<Ack>(EP.delete, { id }, { method: 'POST' })
}

/**
 * 一键清洗老库历史残留按钮
 */
export async function cleanLegacyButtons(): Promise<CleanLegacyData> {
  const res = await request<CleanLegacyData | { data: CleanLegacyData }>(EP.cleanLegacy, {}, { method: 'POST' })
  if (res && 'updatedCount' in res) return res
  return (res as { data?: CleanLegacyData }).data || { updatedCount: 0, message: '' }
}
