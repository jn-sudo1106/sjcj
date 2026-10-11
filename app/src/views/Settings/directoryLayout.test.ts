import { describe, expect, it } from 'vitest'
import { descendants, directoryTypeOf, moveTarget, queueDirectoryTemplatePresets, sourceTree, targetPath, withDirectoryType } from './directoryLayout'
import type { DirectoryLayout } from '@/api/runnerManagement'

const sample = (): DirectoryLayout => ({ codeId: 'a', configId: 'c', queueName: 'q', siteHost: '', revision: 'v', directoryTemplate: '{configId}', entryPoint: 'news/main.py', nodes: [
  { id: 'news', parentId: '', name: 'news', kind: 'folder' },
  { id: 'main', parentId: 'news', name: 'main.py', kind: 'file', repoId: 'r', sourcePath: 'src/main.py' },
  { id: 'shared', parentId: '', name: 'shared', kind: 'folder' },
] })
describe('目标目录编辑', () => {
  it('网站和多层自定义目录切换环境时保留所属根目录', () => {
    expect(withDirectoryType('{website}', 'prd', 'website')).toBe('{website}/prod')
    expect(withDirectoryType('', 'test', 'website')).toBe('{website}/test')
    expect(withDirectoryType('shared/python', 'prd', 'custom', 'shared/python')).toBe('shared/python/prod')
    expect(withDirectoryType('shared/python/prod', 'default', 'custom', 'shared/python')).toBe('shared/python')
    expect(withDirectoryType('', 'test', 'custom', 'shared/python')).toBe('shared/python/test')
  })
  it('队列绑定的类型切换和空模板回退只使用队列层级', () => {
    expect(queueDirectoryTemplatePresets.every(template => !template.includes('{configId}'))).toBe(true)
    expect(withDirectoryType('{queue}', 'prd', 'queue')).toBe('{queue}/prod')
    expect(withDirectoryType('{queue}/prod', 'test', 'queue')).toBe('{queue}/test')
    expect(withDirectoryType('{queue}/test', 'default', 'queue')).toBe('{queue}')
    expect(withDirectoryType('prod', 'default', 'queue')).toBe('{queue}')
    expect(withDirectoryType('', 'test', 'queue')).toBe('{queue}/test')
  })
  it('环境位于配置 ID 后，切换类型保留自定义路径', () => {
    const base = 'custom/{configId}/{queue}'
    const production = withDirectoryType(base, 'prd')
    expect(production).toBe('custom/{configId}/prod/{queue}')
    const test = withDirectoryType(production, 'test')
    expect(test).toBe('custom/{configId}/test/{queue}')
    expect(withDirectoryType(test, 'default')).toBe(base)
    expect(withDirectoryType(production, 'prd')).toBe(production)
  })
  it('识别已保存的三种目录类型，兼容旧环境变量模板', () => {
    expect(directoryTypeOf('{configId}')).toBe('default')
    expect(directoryTypeOf('{configId}/prod')).toBe('prd')
    expect(directoryTypeOf('{configId}/test')).toBe('test')
    expect(directoryTypeOf('{configId}/{queue}')).toBe('default')
    expect(directoryTypeOf('{configId}/{queue}/prod')).toBe('prd')
    expect(directoryTypeOf('{configId}/prd/{queue}')).toBe('prd')
    expect(directoryTypeOf('prd/{configId}')).toBe('prd')
    expect(directoryTypeOf('{environment}/{configId}', 'prd')).toBe('prd')
    expect(withDirectoryType('{environment}/{configId}', 'test')).toBe('{configId}/test')
    expect(withDirectoryType('{environment}/{configId}', 'default')).toBe('{configId}')
    expect(withDirectoryType('prd', 'default')).toBe('{configId}')
  })
  it('保留用户设置的环境与队列顺序，并兼容旧前缀', () => {
    expect(withDirectoryType('{configId}/{queue}/test', 'prd')).toBe('{configId}/{queue}/prod')
    expect(withDirectoryType('{configId}/prod/{queue}', 'test')).toBe('{configId}/test/{queue}')
    expect(withDirectoryType('{configId}/{queue}/prod', 'default')).toBe('{configId}/{queue}')
    expect(withDirectoryType('prd/{configId}/{queue}', 'test')).toBe('{configId}/test/{queue}')
    expect(withDirectoryType('custom/{queue}', 'prd')).toBe('custom/{queue}/prod')
  })
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
