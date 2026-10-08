import type { DirectoryLayout, DirectoryMappingNode, RepositoryTree } from '@/api/runnerManagement'

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
