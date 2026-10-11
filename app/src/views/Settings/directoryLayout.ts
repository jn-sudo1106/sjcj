import type { DirectoryBindingType, DirectoryLayout, DirectoryMappingNode, RepositoryTree } from '@/api/runnerManagement'

export type DirectoryType = 'default' | 'prd' | 'test'
export const directoryTemplatePresets = [
  '{configId}', '{configId}/prod', '{configId}/test', '{configId}/{queue}',
  '{configId}/prod/{queue}', '{configId}/test/{queue}',
  '{configId}/{queue}/prod', '{configId}/{queue}/test',
]
export const queueDirectoryTemplatePresets = ['{queue}', '{queue}/prod', '{queue}/test', 'prod/{queue}', 'test/{queue}']
export const websiteDirectoryTemplatePresets = ['{website}', '{website}/prod', '{website}/test', 'prod/{website}', 'test/{website}']
export const directoryBindingOptions = [
  { value: 'config', label: '配置' }, { value: 'queue', label: '队列' },
  { value: 'website', label: '网站' }, { value: 'custom', label: '自定义目录' },
] as const
export const isDirectoryBindingType = (value: unknown): value is DirectoryBindingType => directoryBindingOptions.some(option => option.value === value)
export const directoryBindingLabel = (type: DirectoryBindingType) => directoryBindingOptions.find(option => option.value === type)!.label
export const directoryOwnerQuery = (type: DirectoryBindingType, owner: string) => ({ [{ config: 'configId', queue: 'queue', website: 'website', custom: 'directory' }[type]]: owner })
const isEnvironmentDirectory = (part: string) => ['prod', 'prd', 'test', '{environment}'].includes(part)
export function directoryTypeOf(template: string, environment: 'prd' | 'test' = 'test'): DirectoryType {
  const part = template.split('/').find(isEnvironmentDirectory)
  if (part === 'prod' || part === 'prd') return 'prd'
  if (part === 'test') return 'test'
  return template.includes('{environment}') ? environment : 'default'
}
export function withDirectoryType(template: string, type: DirectoryType, bindingType: DirectoryBindingType = 'config', customRoot = 'shared'): string {
  const rootToken = { config: '{configId}', queue: '{queue}', website: '{website}', custom: customRoot }[bindingType]
  const parts = template.split('/').filter(Boolean)
  const index = parts.findIndex(isEnvironmentDirectory)
  const name = type === 'prd' ? 'prod' : type
  if (index < 0 && template.includes('{environment}')) {
    return type === 'default' ? template.replaceAll('{environment}', '').split('/').filter(Boolean).join('/') || rootToken : template
  }
  // Preserve an explicitly configured environment position. Earlier presets
  // put it first; move those behind the owner when changing the directory type.
  if (index >= 0) {
    if (type === 'default' || index === 0) parts.splice(index, 1)
    else { parts[index] = name; return parts.join('/') }
  }
  if (!parts.length) parts.push(rootToken)
  if (type !== 'default') {
    const rootIndex = parts.indexOf(rootToken)
    parts.splice(rootIndex < 0 ? parts.length : rootIndex + 1, 0, name)
  }
  return parts.join('/')
}

export interface DirectoryTreeNode extends DirectoryMappingNode { children: DirectoryTreeNode[] }
export function targetTree(nodes: DirectoryMappingNode[]): DirectoryTreeNode[] {
  const indexed = new Map(nodes.map((node) => [node.id, { ...node, children: [] as DirectoryTreeNode[] }]))
  const roots: DirectoryTreeNode[] = []
  for (const node of indexed.values()) {
    if (node.parentId && indexed.has(node.parentId)) indexed.get(node.parentId)!.children.push(node)
    else roots.push(node)
  }
  return roots
}
export function targetPath(nodes: DirectoryMappingNode[], id: string): string {
  const parts: string[] = [], visited = new Set<string>()
  let node = nodes.find((item) => item.id === id)
  while (node && !visited.has(node.id)) {
    visited.add(node.id)
    parts.unshift(node.name)
    node = nodes.find((item) => item.id === node!.parentId)
  }
  return parts.join('/')
}
export function descendants(nodes: DirectoryMappingNode[], id: string): Set<string> {
  const result = new Set([id])
  for (let changed = true; changed;) {
    changed = false
    for (const node of nodes) if (result.has(node.parentId) && !result.has(node.id)) { result.add(node.id); changed = true }
  }
  return result
}
export function moveTarget(layout: DirectoryLayout, id: string, parentId: string): boolean {
  const node = layout.nodes.find((item) => item.id === id)
  const parent = layout.nodes.find((item) => item.id === parentId)
  if (!node || (parentId && (!parent || parent.kind !== 'folder')) || descendants(layout.nodes, id).has(parentId)) return false
  if (layout.nodes.some((item) => item.id !== id && item.parentId === parentId && item.name.toLowerCase() === node.name.toLowerCase())) return false
  const oldEntryNode = layout.nodes.find((item) => targetPath(layout.nodes, item.id) === layout.entryPoint)
  const oldPath = targetPath(layout.nodes, id)
  node.parentId = parentId
  const nextPath = targetPath(layout.nodes, id)
  if (oldEntryNode) layout.entryPoint = targetPath(layout.nodes, oldEntryNode.id)
  else if (layout.entryPoint.startsWith(oldPath + '/')) layout.entryPoint = nextPath + layout.entryPoint.slice(oldPath.length)
  return true
}
export interface SourceTreeNode { id: string; path: string; name: string; kind: 'file' | 'directory'; selectable: boolean; children: SourceTreeNode[] }
export function sourceTree(tree: RepositoryTree | null, keyword: string): SourceTreeNode[] {
  if (!tree) return []
  const indexed = new Map<string, SourceTreeNode>()
  const search = keyword.trim().toLowerCase()
  const paths = new Set<string>()
  for (const item of tree.items) {
    if (!search || item.path.toLowerCase().includes(search)) {
      const parts = item.path.split('/')
      for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'))
    }
  }
  for (const item of tree.items) if (paths.has(item.path)) indexed.set(item.path, { ...item, id: item.path, name: item.path.split('/').at(-1)!, children: [] })
  const roots: SourceTreeNode[] = []
  for (const node of indexed.values()) {
    const parent = node.path.split('/').slice(0, -1).join('/')
    if (parent && indexed.has(parent)) indexed.get(parent)!.children.push(node)
    else roots.push(node)
  }
  return roots
}
