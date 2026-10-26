import { expect, it } from 'vitest'
import { createGenerationTaskId, generationWorkspace } from './generationWorkspace'
import type { ModelInterface } from '@/api/runnerManagement'

it('使用生成服务器实例 ID 与任务 ID 拼接 Windows、Linux 目录', () => {
  const config = { id: 'interface-1', generationServerId: 'server-1', prjDir: 'D:\\aicode\\' } as ModelInterface
  expect(generationWorkspace(config, 'task-1')).toMatchObject({
    prjDir: 'D:\\aicode\\', codeDir: 'D:\\aicode\\server-1\\task-1\\code',
    inputFileDir: 'D:\\aicode\\server-1\\task-1\\input', outputFileDir: 'D:\\aicode\\server-1\\task-1\\output',
  })
  expect(generationWorkspace({ ...config, prjDir: '/data/code/' }, 'task-2').codeDir).toBe('/data/code/server-1/task-2/code')
  expect(generationWorkspace({ ...config, generationServerId: '', prjDir: '/' }, 'task-3').codeDir).toBe('/interface-1/task-3/code')
})
it('每次调用使用独立且可安全作为目录名的标识', () => {
  const first = createGenerationTaskId()
  expect(first).toMatch(/^[a-f0-9]{32}$/)
  expect(createGenerationTaskId()).not.toBe(first)
})
