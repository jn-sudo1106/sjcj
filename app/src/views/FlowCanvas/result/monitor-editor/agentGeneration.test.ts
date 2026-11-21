import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generateSiteScript: vi.fn() }))
vi.mock('@/api/siteScript', () => ({ generateSiteScript: mocks.generateSiteScript }))

import { runnerManagementApi, type CodeRepository, type CodeRepositoryDirectory, type GeneratedCodeArchive, type ModelInterface } from '@/api/runnerManagement'
import {
  archiveStatusText,
  defaultMonitorDirectory,
  defaultMonitorRepo,
  generateMonitorScriptWithAgent,
  loadAgentGenerationOptions,
  loadMonitorDirectories,
  monitorScriptPath,
} from './agentGeneration'

afterEach(() => { vi.restoreAllMocks(); mocks.generateSiteScript.mockReset() })

const agent = (id: string, kind: ModelInterface['kind'], enabled = true) => ({ id, name: id, kind, enabled, model: 'm' }) as ModelInterface
const repo = (repoId: string, configType = '', status: CodeRepository['status'] = 'ACTIVE', isDefault = false) => ({ repoId, name: repoId, configType, status, isDefault }) as CodeRepository
const dir = (directoryId: string, configType: string, status: CodeRepositoryDirectory['status'] = 'ACTIVE', generationDefault = false) =>
  ({ directoryId, repoId: 'r', name: directoryId, path: directoryId, configType, configTypeName: '', status, isDefault: false, generationDefault }) as CodeRepositoryDirectory

describe('智能体生成选项', () => {
  it('只给启用的代码生成智能体（首项全选），仓库只留通用 / 610 且启用的', async () => {
    vi.spyOn(runnerManagementApi, 'modelInterfaces').mockResolvedValue({ items: [agent('a1', 'agent'), agent('chat', 'chat'), agent('off', 'agent', false)], revision: 1 })
    vi.spyOn(runnerManagementApi, 'codeRepositories').mockResolvedValue([repo('shared'), repo('mon', '610'), repo('web', '90'), repo('old', '610', 'DISABLED')])
    const options = await loadAgentGenerationOptions()
    expect(options.agents.map((item) => item.id)).toEqual(['all', 'a1'])
    expect(options.repos.map((item) => item.repoId)).toEqual(['shared', 'mon'])
    expect(defaultMonitorRepo(options.repos)).toBe('mon')
  })

  it('接口失败分别报原因，不抛出', async () => {
    vi.spyOn(runnerManagementApi, 'modelInterfaces').mockRejectedValue(new Error('认证服务不可用'))
    vi.spyOn(runnerManagementApi, 'codeRepositories').mockResolvedValue([])
    const options = await loadAgentGenerationOptions()
    expect(options.agents).toEqual([])
    expect(options.agentError).toBe('认证服务不可用')
  })

  it('目录优先 610 类型，没有就退通用；默认取「生成默认目录」', async () => {
    vi.spyOn(runnerManagementApi, 'codeRepositoryDirectories').mockResolvedValueOnce([dir('web', '90'), dir('m1', '610'), dir('m2', '610', 'ACTIVE', true), dir('m3', '610', 'DISABLED')])
    const typed = await loadMonitorDirectories('r')
    expect(typed.map((row) => row.directoryId)).toEqual(['m1', 'm2'])
    expect(defaultMonitorDirectory(typed)).toBe('m2')
    vi.spyOn(runnerManagementApi, 'codeRepositoryDirectories').mockResolvedValueOnce([dir('web', '90'), dir('shared', '')])
    expect((await loadMonitorDirectories('r')).map((row) => row.directoryId)).toEqual(['shared'])
  })
})

describe('generateMonitorScriptWithAgent', () => {
  it('按监控上下文生成：文件名 <监控ID>.py、子目录 <源ID>、610、自动提交；返回清理后的代码与归档路径', async () => {
    const archive = { archiveId: 'a'.repeat(32), status: 'committed', gitCommit: 'abcdef1234', pushed: true, files: [{ path: 'monitor/391006829/3101.py' }] } as GeneratedCodeArchive
    mocks.generateSiteScript.mockResolvedValue({ code: '```python\ndef main():\n    pass\n```', fileName: '3101.py', warnings: [], archive })
    const result = await generateMonitorScriptWithAgent({
      sourceId: '391006829', monitorId: '3101', interfaceId: 'all', repoId: 'r1', directoryId: 'd1', systemPrompt: '系统', userPrompt: '用户',
    })
    expect(mocks.generateSiteScript.mock.calls[0]![0]).toMatchObject({
      monitorContext: { sourceId: '391006829', monitorId: '3101' },
      configType: '610', interfaceId: 'all', repositoryId: 'r1', directoryId: 'd1', destinationMode: 'custom', autoCommit: true,
      fileName: '3101.py', outputSubdirectory: '391006829', userPrompt: '用户', systemPrompt: '系统',
    })
    expect(result.script).toContain('def main()')
    expect(result.script).not.toContain('```')
    expect(result.scriptPath).toBe('monitor/391006829/3101.py')
    expect(archiveStatusText(result.archive)).toBe('commit abcdef12 · 已推送到远程')
  })

  it('归档回执没带文件路径时按所选目录拼预期路径', async () => {
    mocks.generateSiteScript.mockResolvedValue({ code: 'def main():\n    pass', fileName: '3101.py', warnings: [] })
    const result = await generateMonitorScriptWithAgent({
      sourceId: '391006829', monitorId: '3101', interfaceId: 'all', repoId: 'r1', directoryId: 'd1', directoryPath: 'dataMonitor', systemPrompt: '系统', userPrompt: '用户',
    })
    expect(result.scriptPath).toBe('dataMonitor/391006829/3101.py')
  })

  it('归档状态文案', () => {
    expect(archiveStatusText(null)).toBe('')
    expect(archiveStatusText({ status: 'pending' } as GeneratedCodeArchive)).toBe('已生成，待提交 Git')
    expect(archiveStatusText({ status: 'failed', message: '无权限' } as GeneratedCodeArchive)).toBe('提交失败：无权限')
    expect(archiveStatusText({ status: 'committed', gitCommit: '1234567890', pushed: false } as GeneratedCodeArchive)).toBe('commit 12345678 · 仅本地提交（仓库未配置远程）')
    expect(monitorScriptPath('dataMonitor', '1', '')).toBe('')
    expect(monitorScriptPath('', '1', '2')).toBe('')
    expect(monitorScriptPath('/dataMonitor/', '391006829', '3101')).toBe('dataMonitor/391006829/3101.py')
  })
})
