import { expect, it } from 'vitest'
import { createGenerationTaskId, generationWorkspace } from './generationWorkspace'
import type { ModelInterface } from '@/api/runnerManagement'

it('代码目录固定复用，任务 ID 只作为记录文件名', () => {
  const config = { id: 'interface-1', generationServerId: 'server-1', prjDir: 'D:\\aicode\\' } as ModelInterface
  expect(generationWorkspace(config, 'task-1')).toMatchObject({
    prjDir: 'D:\\aicode\\server-1', codeDir: 'D:\\aicode\\server-1\\code',
    inputFileDir: 'D:\\aicode\\server-1\\input', outputFileDir: 'D:\\aicode\\server-1\\output', taskRecordPath: 'D:\\aicode\\server-1\\tasks\\task-1.json',
  })
  expect(generationWorkspace({ ...config, prjDir: '/data/code/' }, 'task-2').codeDir).toBe('/data/code/server-1/code')
  expect(generationWorkspace({ ...config, generationServerId: '', prjDir: '/' }, 'task-3').codeDir).toBe('/interface-1/code')
  expect(generationWorkspace(config, 'another-task').codeDir).toBe(generationWorkspace(config, 'task-1').codeDir)
})
it('每次调用使用独立且可安全作为目录名的标识', () => {
  const first = createGenerationTaskId()
  expect(first).toMatch(/^[a-f0-9]{32}$/)
  expect(createGenerationTaskId()).not.toBe(first)
})
