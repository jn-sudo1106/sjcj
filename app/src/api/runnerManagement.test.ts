// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runnerManagementApi } from './runnerManagement'

afterEach(() => vi.unstubAllGlobals())

describe('Runner 管理接口', () => {
  it('读取真实实例列表，保持同 IP 不同目录的两条记录', async () => {
    const rows = [
      { runnerId: 'r-1', ipAddress: '10.0.0.8', installDirectory: 'D:\\a' },
      { runnerId: 'r-2', ipAddress: '10.0.0.8', installDirectory: 'D:\\b' },
    ]
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => rows })
    vi.stubGlobal('fetch', fetchSpy)
    expect(await runnerManagementApi.instances()).toEqual(rows)
    expect(fetchSpy).toHaveBeenCalledWith('/api/runner-management/runners', expect.objectContaining({ credentials: 'include' }))
  })

  it('接口不可用时明确报错，不退回演示数据', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(runnerManagementApi.instances()).rejects.toThrow('Runner 管理服务不可达')
  })

  it('分配按稳定 runnerId 提交，不使用 IP 与安装目录作为身份', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignmentId: 'a-1' }) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.createAssignment({ runnerId: 'r-1', queue: 'news_snt', processorType: 'newslink', releaseDigest: 'sha256:abc', concurrency: 1, enabled: true, environment: 'test' })
    const payload = JSON.parse(fetchSpy.mock.calls[0]![1].body as string)
    expect(payload.runnerId).toBe('r-1')
    expect(payload).not.toHaveProperty('ipAddress')
  })

  it('代码仓库路径从系统配置接口读取并保存为服务器绝对路径', async () => {
    const setting = { path: 'E:\\ce\\site-scripts', defaultPath: 'E:\\ce\\site-scripts', remoteUrl: '', branch: 'main' }
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => setting })
    vi.stubGlobal('fetch', fetchSpy)
    expect(await runnerManagementApi.siteCodeRepository()).toEqual(setting)
    await runnerManagementApi.updateSiteCodeRepository('E:\\ce\\generated-sites')
    await runnerManagementApi.updateSiteCodeGit('https://git.example.com/site-scripts.git', 'main')
    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/runner-management/settings/site-code-repo', expect.objectContaining({ method: 'GET' }))
    expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/runner-management/settings/site-code-repo', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ path: 'E:\\ce\\generated-sites' }),
    }))
    expect(fetchSpy).toHaveBeenNthCalledWith(3, '/api/runner-management/settings/site-code-git', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ remoteUrl: 'https://git.example.com/site-scripts.git', branch: 'main' }),
    }))
  })
})
