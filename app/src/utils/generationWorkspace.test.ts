import { expect, it } from 'vitest'
import { createGenerationTaskId, generationWorkspace, matchingGenerationGitBinding, nodeGenerationCodeDirectory } from './generationWorkspace'
import type { CodeGenerationServer, ModelInterface } from '@/api/runnerManagement'

it('目录Git绑定按最长目录前缀匹配，区分路径边界和远程操作系统', () => {
  const server = { workspace: 'D:\\workspace', generationGitBindings: [
    { path: '', repositoryId: 'root', directoryId: 'default' },
    { path: '101/News/code', repositoryId: 'specific', directoryId: 'default' },
  ] } as CodeGenerationServer
  expect(matchingGenerationGitBinding(server, 'd:\\WORKSPACE\\101\\news\\code\\lib')?.repositoryId).toBe('specific')
  expect(matchingGenerationGitBinding(server, '101/News/code-other')?.repositoryId).toBe('root')
  expect(matchingGenerationGitBinding(server, 'D:\\outside')).toBeUndefined()
  expect(matchingGenerationGitBinding({ ...server, workspace: '/data/workspace' }, '/data/workspace/101/news/code')?.repositoryId).toBe('root')
})

it('配置ID和MQ名称二选一，默认按配置ID，手工代码目录不追加code', () => {
  expect(nodeGenerationCodeDirectory('D:\\workspace', '1401218', 'news_list')).toBe('D:\\workspace\\1401218\\code')
  expect(nodeGenerationCodeDirectory('/data/workspace', '1401218', 'news_list')).toBe('/data/workspace/1401218/code')
  expect(nodeGenerationCodeDirectory('/', '1401218', 'news_list')).toBe('/1401218/code')
  expect(nodeGenerationCodeDirectory('/data/workspace', 'id', 'mq', { workspaceMode: 'config-queue' })).toBe('/data/workspace/id/code')
  expect(nodeGenerationCodeDirectory('D:\\workspace', 'id', 'mq', { codeDirectory: 'D:\\workspace\\manual' })).toBe('D:\\workspace\\manual')
  expect(nodeGenerationCodeDirectory('/data/workspace', 'id', 'mq', { codeDirectory: 'shared/news' })).toBe('/data/workspace/shared/news')
  expect(nodeGenerationCodeDirectory('/data/workspace', 'id', 'mq', { workspaceMode: 'queue' })).toBe('/data/workspace/mq/code')
})

it('代码目录固定复用，任务 ID 只作为记录文件名', () => {
  const config = { id: 'interface-1', generationServerId: 'server-1', prjDir: 'D:\\aicode\\' } as ModelInterface
  expect(generationWorkspace(config, 'task-1')).toMatchObject({
    prjDir: 'D:\\aicode\\', codeDir: 'D:\\aicode\\code',
    inputFileDir: 'D:\\aicode\\input', outputFileDir: 'D:\\aicode\\output', taskRecordPath: 'D:\\aicode\\tasks\\task-1.json',
  })
  expect(generationWorkspace({ ...config, prjDir: '/data/code/' }, 'task-2').codeDir).toBe('/data/code/code')
  expect(generationWorkspace({ ...config, generationServerId: '', prjDir: '/' }, 'task-3').codeDir).toBe('/code')
  expect(generationWorkspace(config, 'another-task').codeDir).toBe(generationWorkspace(config, 'task-1').codeDir)
})
it('每次调用使用独立且可安全作为目录名的标识', () => {
  const first = createGenerationTaskId()
  expect(first).toMatch(/^[a-f0-9]{32}$/)
  expect(createGenerationTaskId()).not.toBe(first)
})
