import { describe, expect, it } from 'vitest'
import { descendants, moveTarget, sourceTree, targetPath } from './directoryLayout'
import type { DirectoryLayout } from '@/api/runnerManagement'

const sample = (): DirectoryLayout => ({ codeId: 'a', configId: 'c', queueName: 'q', siteHost: '', revision: 'v', directoryTemplate: 'packages/{configId}', entryPoint: 'news/main.py', nodes: [
  { id: 'news', parentId: '', name: 'news', kind: 'folder' },
  { id: 'main', parentId: 'news', name: 'main.py', kind: 'file', repoId: 'r', sourcePath: 'src/main.py' },
  { id: 'shared', parentId: '', name: 'shared', kind: 'folder' },
] })
describe('目标目录编辑', () => {
  it('移动目录同步更新入口，仓库来源保持原路径', () => {
    const layout = sample()
    expect(moveTarget(layout, 'news', 'shared')).toBe(true)
    expect(layout.entryPoint).toBe('shared/news/main.py')
    expect(targetPath(layout.nodes, 'main')).toBe('shared/news/main.py')
    expect(layout.nodes[1]!.sourcePath).toBe('src/main.py')
  })
  it('阻止循环、移动到文件内和目标重名', () => {
    const layout = sample()
    expect(moveTarget(layout, 'news', 'main')).toBe(false)
    expect(moveTarget(layout, 'news', 'news')).toBe(false)
    layout.nodes.push({ id: 'duplicate', parentId: 'shared', name: 'news', kind: 'folder' })
    expect(moveTarget(layout, 'news', 'shared')).toBe(false)
    expect(descendants(layout.nodes, 'news')).toEqual(new Set(['news', 'main']))
  })
  it('按文件名搜索保留源目录层级，同时支持整个文件夹选择', () => {
    const tree = sourceTree({ repoId: 'r', gitCommit: 'c', items: [
      { path: 'src', kind: 'directory', size: null, selectable: true },
      { path: 'src/main.py', kind: 'file', size: 20, selectable: true },
      { path: 'src/other.py', kind: 'file', size: 10, selectable: true },
    ] }, 'main')
    expect(tree[0]!.path).toBe('src')
    expect(tree[0]!.children.map(n => n.path)).toEqual(['src/main.py'])
  })
})
