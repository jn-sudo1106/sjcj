// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runnerManagementApi, type DirectoryLayout } from './runnerManagement'

afterEach(() => vi.unstubAllGlobals())

describe('Runner 管理接口', () => {
  it('编排保存按流程节点幂等同步部署配置，携带队列及指定代码版本', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deploymentId: 'deploy1' }) })
    vi.stubGlobal('fetch', fetchSpy)
    const input = { sourceNode: { flowId: '123', flowName: '新闻流程', stepId: '456', nodeName: '抓取列表', configId: '1401081' }, queueName: 'news_list', scriptDigest: 'sha256:code' }
    await runnerManagementApi.ensureNodeDeployment(input)
    expect(fetchSpy).toHaveBeenCalledWith('/api/runner-management/deployment-configurations/from-node', expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
  })
  it('便携包下载沿用登录凭据，按 ZIP 二进制读取并携带地址和版本', async () => {
    const blob = new Blob(['zip'])
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200,
      headers: new Headers({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="Runner-windows-x64-abcdef.zip"' }), blob: async () => blob })
    vi.stubGlobal('fetch', fetchSpy)
    const input = { server: 'http://10.0.0.8:8092', digest: 'sha256:version' }
    const result = await runnerManagementApi.downloadRunnerPackage(input)
    expect(fetchSpy).toHaveBeenCalledWith('/api/runner-management/runner-package', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input) }))
    expect(result).toEqual({ name: 'Runner-windows-x64-abcdef.zip', blob })
  })
  it('包接口错误显示真实原因，不把错误 JSON 当作 ZIP 下载', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: '此版本缺少启动入口' }) })
    vi.stubGlobal('fetch', fetchSpy)
    await expect(runnerManagementApi.downloadRunnerPackage({ server: 'http://host:8092', digest: 'sha256:old' })).rejects.toThrow('此版本缺少启动入口')
  })
  it('运行日志按绑定筛选，输出按游标增量读取，下载沿用登录请求', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.runtimeLogs({ runtimeId: 'binding1', keyword: '抓取', page: 2, since: '' })
    await runnerManagementApi.runtimeLogDetail('run1')
    await runnerManagementApi.runtimeLogEntries('stream1', 9)
    await runnerManagementApi.downloadRuntimeLog('stream1')
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/api/runner-management/runtime-operations?runtimeId=binding1&keyword=%E6%8A%93%E5%8F%96&page=2&since=',
      '/api/runner-management/runtime-operations/run1', '/api/runner-management/log-streams/stream1/entries?cursor=9&before=0',
      '/api/runner-management/log-streams/stream1/download',
    ])
  })
  it('文件夹上传携带上传类型、目录 ID 和各文件相对路径', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchSpy)
    const input = { uploadType: 'folder' as const, directoryId: 'dir1', overwrite: false,
      files: [{ name: 'main.py', relativePath: 'worker/src/main.py', data: 'eA==' }] }
    await runnerManagementApi.uploadCodeRepositoryFiles('repo1', input)
    expect(fetchSpy).toHaveBeenCalledWith('/api/runner-management/settings/code-repos/repo1/files', expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
  })
  it('文件命名发布携带代码 ID，网站命名不预设运行网站或下发路径', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchSpy)
    const input = { configId: 'node1', queueName: 'news_list', codeId: 'code1', fileNameMode: 'website' as const,
      fileName: 'example.com.py', code: 'def scrape(url): pass', prompt: '', url: 'https://example.com/list' }
    await runnerManagementApi.publishScript(input)
    const payload = JSON.parse(fetchSpy.mock.calls[0]![1].body as string)
    expect(payload).toEqual(input)
    expect(payload).not.toHaveProperty('siteHost')
    expect(payload).not.toHaveProperty('directoryTemplate')
  })
  it('独立部署配置和统一运行配置按 ID 保存，绑定携带配置修订号', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchSpy)
    const layout = { codeId: '', configId: '', queueName: '', siteHost: '', nodes: [], directoryTemplate: 'shared/python', entryPoint: '', revision: '', deploymentId: '', name: '公共模块', pathStyle: 'custom' as const }
    await runnerManagementApi.deploymentConfigurations('公共模块')
    await runnerManagementApi.saveDeploymentConfiguration(layout)
    await runnerManagementApi.saveDeploymentConfiguration({ ...layout, deploymentId: 'deploy1', revision: 'v1' })
    const input = { deploymentId: 'deploy1', layoutRevision: 'v2', runnerId: 'r1', environment: 'test' as const, concurrency: 1 }
    await runnerManagementApi.saveRuntimeConfiguration(input)
    await runnerManagementApi.removeRuntimeConfiguration('runtime1', 'rv1')
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/api/runner-management/deployment-configurations?keyword=%E5%85%AC%E5%85%B1%E6%A8%A1%E5%9D%97',
      '/api/runner-management/deployment-configurations', '/api/runner-management/deployment-configurations/deploy1',
      '/api/runner-management/runtime-configurations', '/api/runner-management/runtime-configurations/runtime1/remove',
    ])
    expect(fetchSpy.mock.calls[3]?.[1]).toEqual(expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
    expect(fetchSpy.mock.calls[4]?.[1]).toEqual(expect.objectContaining({ body: JSON.stringify({ revision: 'rv1' }) }))
  })
  it('范围预览和部分下发携带选中路径及上次成功版本', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) })
    vi.stubGlobal('fetch', fetchSpy)
    const binding = { bindingType: 'custom' as const, ownerId: 'shared/python', runnerId: 'r-1' }
    await runnerManagementApi.directoryDeliveryPreview(binding)
    await runnerManagementApi.deliverDirectoryBinding({ ...binding, revision: 'r2', scope: 'selected', paths: ['utils', 'main.py'], baselineDigest: 'sha256:base' })
    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/runner-management/directory-bindings/custom/shared%2Fpython/r-1/delivery-preview', expect.objectContaining({ method: 'GET' }))
    expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/runner-management/directory-bindings/custom/shared%2Fpython/r-1/deliver', expect.objectContaining({ method: 'POST', body: JSON.stringify({ revision: 'r2', scope: 'selected', paths: ['utils', 'main.py'], baselineDigest: 'sha256:base' }) }))
  })
  it('手工下发按运行绑定发送已保存修订号，嵌套目录正确编码', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.deliverDirectoryBinding({ bindingType: 'custom', ownerId: 'shared/python', runnerId: 'r-1', revision: 'saved-revision' })
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/runner-management/directory-bindings/custom/shared%2Fpython/r-1/deliver', expect.objectContaining({ method: 'POST', body: JSON.stringify({ revision: 'saved-revision' }) }))
  })
  it('网站和自定义多层目录使用所属对象读写与解绑，路径正确编码', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.namedDirectoryOwners()
    await runnerManagementApi.websiteDirectoryLayout('www.example.com')
    await runnerManagementApi.customDirectoryLayout('shared/python')
    const layout: DirectoryLayout = { bindingType: 'custom', ownerId: 'shared/python', codeId: '', configId: '', queueName: '', siteHost: '', directoryTemplate: 'shared/python', entryPoint: '', nodes: [], revision: 'v1' }
    await runnerManagementApi.saveDirectoryLayout(layout)
    await runnerManagementApi.saveDirectoryLayout({ ...layout, bindingType: 'website', ownerId: 'www.example.com', directoryTemplate: '{website}' })
    await runnerManagementApi.removeDirectoryBinding({ bindingType: 'custom', ownerId: 'shared/python', runnerId: 'r-1' })
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/api/runner-management/directory-layouts/owners',
      '/api/runner-management/directory-layouts/website?owner=www.example.com',
      '/api/runner-management/directory-layouts/custom?owner=shared%2Fpython',
      '/api/runner-management/directory-layouts/custom?owner=shared%2Fpython',
      '/api/runner-management/directory-layouts/website?owner=www.example.com',
      '/api/runner-management/directory-bindings/custom/shared%2Fpython/r-1',
    ])
  })
  it('目录运行绑定使用独立接口，不调用队列任务分配接口', async () => {
    const input = { bindingType: 'queue' as const, ownerId: 'news.list', runnerId: 'r-1' }
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.directoryBindings()
    await runnerManagementApi.createDirectoryBinding(input)
    await runnerManagementApi.removeDirectoryBinding(input)
    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/runner-management/directory-bindings', expect.objectContaining({ method: 'GET' }))
    expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/runner-management/directory-bindings', expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
    expect(fetchSpy).toHaveBeenNthCalledWith(3, '/api/runner-management/directory-bindings/queue/news.list/r-1', expect.objectContaining({ method: 'DELETE' }))
  })
  it('队列视图使用队列名称读写，独立于配置目录接口', async () => {
    const layout: DirectoryLayout = { bindingType: 'queue', codeId: 'code1', configId: '', queueName: 'www.example.com', siteHost: '', revision: 'v1', directoryTemplate: '{queue}/test', entryPoint: 'main.py', nodes: [] }
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => layout })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.queueDirectoryLayout(layout.queueName)
    await runnerManagementApi.saveDirectoryLayout(layout)
    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/runner-management/directory-layouts/queues/www.example.com', expect.objectContaining({ method: 'GET' }))
    expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/runner-management/directory-layouts/queues/www.example.com', expect.objectContaining({ method: 'POST', body: JSON.stringify(layout) }))
  })
  it('目录视图读取和保存使用同一个配置接口，不调用发布接口', async () => {
    const layout: DirectoryLayout = { codeId: 'code1', configId: '123', queueName: 'news_list', siteHost: '', revision: 'revision-1', directoryTemplate: '{configId}/prod/{queue}', entryPoint: 'main.py', nodes: [] }
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => layout })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.directoryLayout('123')
    await runnerManagementApi.codeRepositoryTree('repo1')
    expect(await runnerManagementApi.saveDirectoryLayout(layout)).toEqual(layout)
    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/runner-management/directory-layouts/configs/123', expect.objectContaining({ method: 'GET' }))
    expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/runner-management/settings/code-repos/repo1/tree', expect.objectContaining({ method: 'GET' }))
    expect(fetchSpy).toHaveBeenNthCalledWith(3, '/api/runner-management/directory-layouts/configs/123', expect.objectContaining({ method: 'POST', body: JSON.stringify(layout) }))
    expect(fetchSpy.mock.calls.map(([url]) => url)).not.toContain('/api/runner-management/directory-layouts/code1/publish')
  })
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

  it('文件时间和版本按选中仓库快照读取，路径正确编码', async () => {
    const metadata = { repoId: 'repo1', path: '网页/列表.py', gitCommit: 'b'.repeat(40), fileCommit: 'a'.repeat(40), createdAt: '2026-10-01T09:00:00+08:00', updatedAt: '2026-10-05T10:00:00+08:00' }
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => metadata })
    vi.stubGlobal('fetch', fetchSpy)
    expect(await runnerManagementApi.codeRepositoryFileMetadata('repo1', metadata.path, metadata.gitCommit)).toEqual(metadata)
    expect(fetchSpy).toHaveBeenCalledWith(`/api/runner-management/settings/code-repos/repo1/files/metadata?path=${encodeURIComponent(metadata.path)}&commit=${metadata.gitCommit}`, expect.objectContaining({ method: 'GET' }))
  })

  it('配置目录按仓库管理，文件查询、上传和节点发布携带目录 ID', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.codeRepositoryDirectories('repo1')
    const input = { name: '网页列表', configType: '90', configTypeName: '网页抓取', path: 'web/list' }
    await runnerManagementApi.saveCodeRepositoryDirectory('repo1', input)
    await runnerManagementApi.saveCodeRepositoryDirectory('repo1', { ...input, revision: 'v1' }, 'dir1')
    await runnerManagementApi.removeCodeRepositoryDirectory('repo1', 'dir1', 'v2')
    await runnerManagementApi.codeRepositoryFiles('repo1', '列表', 1, 'dir1')
    await runnerManagementApi.uploadCodeRepositoryFiles('repo1', { directoryId: 'dir1', overwrite: false, files: [{ name: 'main.py', data: 'AA==' }] })
    await runnerManagementApi.publishScript({ configId: 'c1', fileName: 'main.py', code: 'def scrape(url): pass', prompt: '', url: '', repositoryId: 'repo1', directoryId: 'dir1' })
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/api/runner-management/settings/code-repos/repo1/directories',
      '/api/runner-management/settings/code-repos/repo1/directories',
      '/api/runner-management/settings/code-repos/repo1/directories/dir1',
      '/api/runner-management/settings/code-repos/repo1/directories/dir1?revision=v2',
      '/api/runner-management/settings/code-repos/repo1/files?keyword=%E5%88%97%E8%A1%A8&page=1&directoryId=dir1',
      '/api/runner-management/settings/code-repos/repo1/files', '/api/runner-management/site-scripts/publish',
    ])
    expect(JSON.parse(fetchSpy.mock.calls[6]![1].body as string).directoryId).toBe('dir1')
  })
  it('目录浏览携带相对目录，原路径列表参数保持兼容', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.codeRepositoryFiles('repo1', '', 2, 'dir1', '公共/工具')
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/runner-management/settings/code-repos/repo1/files?keyword=&page=2&directoryId=dir1&view=directory&folder=' + encodeURIComponent('公共/工具'), expect.objectContaining({ method: 'GET' }))
  })
  it('处理进程关闭提交实例、并发序号、PID 和启动代次，不发送任意系统命令', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'pending' }) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.processorProcesses()
    await runnerManagementApi.stopProcessorProcess({ runnerId: 'runner1', assignmentId: 'assignment1', slot: 2, pid: 4567, generation: 'version:started' })
    expect(fetchSpy.mock.calls[0]![0]).toBe('/api/runner-management/processes')
    expect(fetchSpy.mock.calls[1]![0]).toBe('/api/runner-management/runners/runner1/processes/stop')
    expect(JSON.parse(fetchSpy.mock.calls[1]![1].body)).toEqual({ assignmentId: 'assignment1', slot: 2, pid: 4567, generation: 'version:started' })
  })

  it('节点程序启停使用绑定 ID 和当前修订号，不删除绑定', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runtimeId: 'runtime-1' }) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.startRuntimeProgram('runtime-1', 'r1')
    await runnerManagementApi.stopRuntimeProgram('runtime-1', 'r2')
    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/runner-management/runtime-configurations/runtime-1/start', expect.objectContaining({ method: 'POST', body: JSON.stringify({ revision: 'r1' }) }))
    expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/runner-management/runtime-configurations/runtime-1/stop', expect.objectContaining({ method: 'POST', body: JSON.stringify({ revision: 'r2' }) }))
  })
  it('机器配置保存独立的重试策略，保留次数和秒单位', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ runtimeId: 'runtime-1' }) })
    vi.stubGlobal('fetch', fetchSpy)
    const retryPolicy = { enabled: false, maxAttempts: 2, windowSeconds: 120, delaysSeconds: [10, 30] }
    await runnerManagementApi.saveRuntimeConfiguration({ runtimeId: 'runtime-1', revision: 'r1', deploymentId: 'd1', layoutRevision: 'v1', runnerId: 'r1', environment: 'test', concurrency: 1, retryPolicy })
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body as string).retryPolicy).toEqual(retryPolicy)
  })

  it('接口不可用时明确报错，不退回演示数据', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(runnerManagementApi.instances()).rejects.toThrow('Runner 管理服务不可达')
  })

  it('分配按稳定 runnerId 提交，不使用 IP 与实例目录作为身份', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignmentId: 'a-1' }) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.createAssignment({ runnerId: 'r-1', queue: 'news_snt', processorType: 'newslink', releaseDigest: 'sha256:abc', concurrency: 1, enabled: true, environment: 'test' })
    const payload = JSON.parse(fetchSpy.mock.calls[0]![1].body as string)
    expect(payload.runnerId).toBe('r-1')
    expect(payload).not.toHaveProperty('ipAddress')
  })

  it('选择节点代码创建分配时只发送代码摘要，队列与处理程序由后台确定', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ assignmentId: 'a-1' }) })
    vi.stubGlobal('fetch', fetchSpy)
    await runnerManagementApi.createAssignment({ runnerId: 'r-1', scriptDigest: 'sha256:node-code', concurrency: 2, environment: 'production' })
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body as string)).toEqual({ runnerId: 'r-1', scriptDigest: 'sha256:node-code', concurrency: 2, environment: 'production' })
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
