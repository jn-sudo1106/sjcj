// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { runnerManagementApi, type ArtifactRelease, type QueueAssignment, type RunnerInstance, type SiteCodeVersion } from '@/api/runnerManagement'
import { useAuthStore } from '@/stores/auth'
import RunnerManagementTab from './RunnerManagementTab.vue'

const instances: RunnerInstance[] = [
  { runnerId: 'r-1', name: '正式', ipAddress: '10.0.0.8', installDirectory: 'D:\\runner-prod', platform: 'windows', capabilities: [], status: 'online', lastHeartbeat: '2026-10-04 12:00', desiredDigest: 'abc', actualDigest: 'abc', assignmentCount: 1 },
  { runnerId: 'r-2', name: '测试', ipAddress: '10.0.0.8', installDirectory: 'D:\\runner-test', platform: 'windows', capabilities: [], status: 'offline', lastHeartbeat: null, desiredDigest: 'def', actualDigest: null, assignmentCount: 0 },
]

beforeEach(() => {
  vi.restoreAllMocks()
  setActivePinia(createPinia())
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function render() {
  const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus] } })
  await flushPromises()
  const status = wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('data-testid') === 'runner-status-filter')!
  status.vm.$emit('update:modelValue', ''); await flushPromises()
  return wrapper
}

describe('Runner 实例页面', () => {
  it('左栏机器详情挂载到body，中文字段及长值不受服务器卡片裁剪', async () => {
    const { wrapper } = await renderBatchUpgrade()
    await wrapper.setProps({ compact: true, selectable: true, selectedRunnerId: 'r-1' })
    expect(wrapper.get('.rm-server-card').text()).not.toContain('PID')
    expect(wrapper.get('.rm-server-card').text()).not.toContain('Runner')
    expect(wrapper.get('.rm-server-card').text()).not.toContain('详情')
    wrapper.vm.openInstanceDetails('r-1'); await flushPromises()
    const drawer = wrapper.findComponent({ name: 'ElDrawer' })
    expect(drawer.props('appendToBody')).toBe(true)
    expect(drawer.props('size')).toBe('min(760px, 94vw)')
    const panel = document.querySelector('[data-testid="runner-instance-detail"]')!
    expect(panel).not.toBeNull()
    expect(panel.closest('.rm-main')).toBeNull()
    expect(panel.textContent).toContain('实例 ID')
    expect(panel.textContent).toContain('r-1')
    expect(panel.textContent).toContain('机器 IP')
    expect(panel.textContent).toContain('在线')
    expect(panel.textContent).toContain('D:\\runner-prod')
    wrapper.unmount()
  })
  it('统一页面从服务器列表按实例ID进入对应配置', async () => {
    const { wrapper } = await renderBatchUpgrade()
    await wrapper.setProps({ selectable: true, compact: true, selectedRunnerId: 'r-1' })
    expect(wrapper.find('.rm-server-card.selected [data-testid="runner-card-r-1"]').exists()).toBe(true)
    expect(wrapper.find('.rm-runner-table').exists()).toBe(false)
    await wrapper.get('[data-testid="runner-card-r-2"]').trigger('click')
    expect(wrapper.emitted('selectRunner')).toEqual([['r-2']])
    expect(wrapper.emitted('instancesChange')?.[0]).toEqual([instances])
    await wrapper.setProps({ selectionDisabled: true })
    expect(wrapper.get('[data-testid="runner-card-r-2"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('左侧机器筛选将匹配实例及筛选状态通知配置面板', async () => {
    const { wrapper } = await renderBatchUpgrade()
    await wrapper.setProps({ compact: true, selectable: true })
    await wrapper.get('input[aria-label="搜索服务器"]').setValue('runner-test')
    expect(wrapper.emitted('visibleInstancesChange')?.at(-1)).toEqual([[instances[1]], true])
    expect(wrapper.find('[data-testid="runner-card-r-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="runner-card-r-2"]').exists()).toBe(true)
    await wrapper.get('input[aria-label="搜索服务器"]').setValue('')
    expect(wrapper.emitted('visibleInstancesChange')?.at(-1)).toEqual([instances, false])
    wrapper.unmount()
  })
  it('IP和状态可组合筛选，同IP多个实例均保留且改变筛选清空升级选择', async () => {
    const { wrapper } = await renderBatchUpgrade()
    vi.mocked(runnerManagementApi.instances).mockResolvedValue([...instances, { ...instances[0]!, runnerId: 'r-3', ipAddress: '10.0.0.9', name: '另一台服务器' }])
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    const ip = wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('data-testid') === 'runner-ip-filter')!
    const status = wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('data-testid') === 'runner-status-filter')!
    await wrapper.get('[data-testid="runner-select-all"] input').setValue(true)
    ip.vm.$emit('update:modelValue', '10.0.0.8'); await flushPromises()
    expect(wrapper.get('[data-testid="runner-batch-upgrade"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="runner-select-r-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="runner-select-r-2"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="runner-select-r-3"]').exists()).toBe(false)
    await wrapper.get('[data-testid="runner-select-all"] input').setValue(true)
    status.vm.$emit('update:modelValue', 'offline'); await flushPromises()
    expect(wrapper.get('[data-testid="runner-batch-upgrade"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="runner-select-r-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="runner-select-r-2"]').exists()).toBe(true)
    await wrapper.get('input[placeholder="IP、目录、实例名"]').setValue('runner-prod')
    expect(wrapper.text()).toContain('暂无符合筛选条件的服务器实例')
    await wrapper.get('input[placeholder="IP、目录、实例名"]').setValue('')
    ip.vm.$emit('update:modelValue', ''); status.vm.$emit('update:modelValue', ''); await flushPromises()
    expect(wrapper.find('[data-testid="runner-select-r-3"]').exists()).toBe(true)
    wrapper.unmount()
  })
  async function renderBatchUpgrade() {
    useAuthStore().roles = ['admin']
    const latest: ArtifactRelease = { digest: 'sha256:batch-latest', kind: 'runner', name: 'Runner', platform: 'any', gitCommit: 'local', status: 'published', publishedAt: '2026-10-12T17:31:49Z', signature: '', usedBy: 0 }
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([
      { ...latest, digest: 'sha256:older', publishedAt: '2026-10-12T16:00:00Z' }, latest,
      { ...latest, digest: 'sha256:draft', status: 'candidate', publishedAt: '2026-10-13T01:00:00Z' },
    ])
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus],
      stubs: { ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' } } } })
    await flushPromises()
    const status = wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('data-testid') === 'runner-status-filter')!
    expect(status.props('modelValue')).toBe('online')
    expect(wrapper.find('[data-testid="runner-select-r-2"]').exists()).toBe(false)
    // Batch/filter scenarios below explicitly include offline instances.
    status.vm.$emit('update:modelValue', ''); await flushPromises()
    return { wrapper, latest }
  }
  it('勾选按实例 ID 区分同 IP 目录，全选只覆盖当前筛选且筛选后清空选择', async () => {
    const { wrapper } = await renderBatchUpgrade()
    expect(wrapper.get('[data-testid="runner-batch-upgrade"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="runner-select-all"] input').setValue(true)
    expect(wrapper.get('[data-testid="runner-batch-upgrade"]').text()).toContain('（2）')
    await wrapper.get('input[placeholder="IP、目录、实例名"]').setValue('runner-prod')
    expect(wrapper.get('[data-testid="runner-batch-upgrade"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="runner-select-r-2"]').exists()).toBe(false)
    await wrapper.get('[data-testid="runner-select-all"] input').setValue(true)
    expect(wrapper.get('[data-testid="runner-batch-upgrade"]').text()).toContain('（1）')
    vi.mocked(runnerManagementApi.instances).mockResolvedValue([])
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="runner-batch-upgrade"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('一键给所有勾选实例下发最新已发布版本，分别显示失败并仅重试失败实例', async () => {
    const { wrapper, latest } = await renderBatchUpgrade()
    const send = vi.spyOn(runnerManagementApi, 'setDesiredRunner').mockImplementation(async (id, digest) => {
      if (id === 'r-2') throw new Error('实例升级接口暂时不可用')
      return { runnerId: id, digest }
    })
    await wrapper.get('[data-testid="runner-select-all"] input').setValue(true)
    await wrapper.get('[data-testid="runner-batch-upgrade"]').trigger('click'); await flushPromises()
    expect(send.mock.calls).toEqual([['r-1', latest.digest], ['r-2', latest.digest]])
    const result = wrapper.get('[data-testid="runner-batch-results"]')
    expect(result.text()).toContain('已下发 · 等待升级')
    expect(result.text()).toContain('下发失败')
    expect(result.text()).toContain('实例升级接口暂时不可用')
    expect((wrapper.get('[data-testid="runner-select-r-1"] input').element as HTMLInputElement).checked).toBe(false)
    expect((wrapper.get('[data-testid="runner-select-r-2"] input').element as HTMLInputElement).checked).toBe(true)
    send.mockResolvedValue({ runnerId: 'r-2', digest: latest.digest })
    await wrapper.get('[data-testid="runner-batch-upgrade"]').trigger('click'); await flushPromises()
    expect(send).toHaveBeenCalledTimes(3)
    expect(send).toHaveBeenLastCalledWith('r-2', latest.digest)
    expect(wrapper.get('[data-testid="runner-batch-results"]').text()).toContain('已下发 · 等待上线')
    vi.mocked(runnerManagementApi.instances).mockResolvedValue(instances.map(row => ({ ...row, actualDigest: latest.digest })))
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="runner-batch-results"]').text()).toContain('已升级')
    wrapper.unmount()
  })
  it('批量请求处理中禁用重复提交，非管理员不显示升级勾选入口', async () => {
    const { wrapper, latest } = await renderBatchUpgrade()
    let complete!: (value: { runnerId: string; digest: string }) => void
    const send = vi.spyOn(runnerManagementApi, 'setDesiredRunner').mockImplementation(() => new Promise(resolve => { complete = resolve }))
    await wrapper.get('[data-testid="runner-select-r-1"] input').setValue(true)
    await wrapper.get('[data-testid="runner-batch-upgrade"]').trigger('click')
    expect(wrapper.get('[data-testid="runner-batch-upgrade"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="runner-batch-results"]').text()).toContain('正在下发')
    await wrapper.get('[data-testid="runner-batch-upgrade"]').trigger('click')
    expect(send).toHaveBeenCalledTimes(1)
    complete({ runnerId: 'r-1', digest: latest.digest }); await flushPromises()
    useAuthStore().roles = []; await flushPromises()
    expect(wrapper.find('[data-testid="runner-batch-upgrade"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="runner-select-all"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('下载包默认采用推荐地址和最新版本，错误保留配置后可重试下载', async () => {
    useAuthStore().roles = ['admin']
    const release: ArtifactRelease = { digest: 'sha256:latest', kind: 'runner', name: 'native-runner', platform: 'win32', gitCommit: 'local', status: 'published', publishedAt: '2026-10-12T16:27:02Z', signature: '', usedBy: 0 }
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([release])
    vi.spyOn(runnerManagementApi, 'runnerPackageInfo').mockResolvedValue({ ready: true, server: 'http://10.0.0.8:8092', platform: 'windows-x64', pythonVersion: '3.12.9', releases: [release], enrollmentMinutes: 15 })
    const download = vi.spyOn(runnerManagementApi, 'downloadRunnerPackage').mockRejectedValueOnce(new Error('运行环境缺少文件'))
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus],
      stubs: { ElDialog: { name: 'ElDialog', props: ['modelValue', 'title'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' } } } }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '下载 Runner 包')!.trigger('click'); await flushPromises()
    const dialog = wrapper.findAllComponents({ name: 'ElDialog' }).find(component => component.props('title') === '下载 Runner 包')!
    expect(dialog.text()).toContain('Windows 64 位便携包')
    expect(dialog.text()).toContain('15 分钟')
    expect(dialog.text()).toContain('同一包可复制到多个目录')
    expect(dialog.text()).toContain('已登记实例重启不受影响')
    expect(dialog.findComponent({ name: 'ElInput' }).props('modelValue')).toBe('http://10.0.0.8:8092')
    expect(dialog.findComponent({ name: 'ElSelect' }).props('modelValue')).toBe(release.digest)
    await dialog.findAll('button').find(button => button.text() === '下载 ZIP 包')!.trigger('click'); await flushPromises()
    expect(dialog.text()).toContain('运行环境缺少文件')
    const create = vi.fn().mockReturnValue('blob:package'), revoke = vi.fn()
    const BaseURL = URL
    vi.stubGlobal('URL', class extends BaseURL { static createObjectURL = create; static revokeObjectURL = revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    download.mockResolvedValueOnce({ name: 'Runner-windows-x64-latest.zip', blob: new Blob(['zip']) })
    await dialog.findAll('button').find(button => button.text() === '下载 ZIP 包')!.trigger('click'); await flushPromises()
    expect(download).toHaveBeenLastCalledWith({ server: 'http://10.0.0.8:8092', digest: release.digest })
    expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('Runner 版本按发布时间倒序，显示北京时间并只标记最新已发布版本', async () => {
    const base: ArtifactRelease = { digest: 'sha256:older', kind: 'runner', name: '旧版本', platform: 'any', gitCommit: 'local', status: 'published', publishedAt: '2026-10-12T15:08:29Z', signature: '', usedBy: 0 }
    const items = [base, { ...base, digest: 'sha256:latest', name: '最新稳定版本', publishedAt: '2026-10-12T16:27:02Z' },
      { ...base, digest: 'sha256:undated', name: '旧未记录日期版本', publishedAt: null }]
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue(items)
    const wrapper = mount(RunnerManagementTab, { props: { section: 'releases' }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0]!.text()).toContain('最新稳定版本')
    expect(rows[0]!.text()).toContain('最新发布')
    expect(rows[0]!.get('[data-testid="runner-published-at"]').text()).toBe('2026-10-13 00:27:02')
    expect(rows[1]!.text()).toContain('2026-10-12 23:08:29')
    expect(rows[2]!.text()).toContain('时间未记录')
    expect(rows[2]!.text()).not.toContain('最新发布')
    expect(items[0]!.digest).toBe('sha256:older')
    wrapper.unmount()
  })
  it('机器显示当前版本发布时间，版本选项按时间排序且保留原升级目标', async () => {
    useAuthStore().roles = ['admin']
    const old: ArtifactRelease = { digest: 'sha256:old', kind: 'runner', name: '旧 Runner', platform: 'any', gitCommit: 'local', status: 'published', publishedAt: '2026-10-12T15:08:29Z', signature: '', usedBy: 0 }
    const latest = { ...old, digest: 'sha256:new', name: '新 Runner', publishedAt: '2026-10-12T16:27:02Z' }
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, actualDigest: old.digest, desiredDigest: old.digest }])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([old, latest])
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { stubs: assignmentStubs, directives: { loading: {} } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="runner-version"]').text()).toContain('2026-10-12 23:08:29')
    await wrapper.findAll('button').find(item => item.text() === '设置 Runner 版本')!.trigger('click')
    const select = wrapper.get('[data-testid="runner-upgrade-version"]')
    const choices = select.findAll('option').filter(item => item.attributes('value'))
    expect(choices[0]!.attributes('value')).toBe(latest.digest)
    expect(choices[0]!.text()).toContain('2026-10-13 00:27:02')
    expect(choices[0]!.text()).toContain('最新发布')
    expect((select.element as HTMLSelectElement).value).toBe(old.digest)
    wrapper.unmount()
  })
  it('心跳列表、提示和详情将 UTC 转换为补零的北京时间', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, lastHeartbeat: '2026-10-12T16:36:50+00:00' }, instances[1]!])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = await render(); await flushPromises()
    const cells = wrapper.findAll('[data-testid="runner-heartbeat"]')
    expect(cells[0]!.text()).toBe('2026-10-13 00:36:50')
    expect(cells[0]!.attributes('title')).toContain('北京时间')
    expect(cells[1]!.text()).toBe('未收到心跳')
    await wrapper.findAll('tbody tr')[0]!.findAll('button').find(button => button.text() === '详情')!.trigger('click'); await flushPromises()
    const detail = document.querySelector('[data-testid="runner-instance-detail"]')!
    expect(detail.textContent).toContain('最近心跳（北京时间）')
    expect(detail.textContent).toContain('2026-10-13 00:36:50')
    expect(detail.textContent).not.toContain('2026-10-12T16:36:50+00:00')
    wrapper.unmount()
  })
  it('Runner 版本页面只显示 Runner 自身版本，隐藏处理程序及业务代码', async () => {
    const common = { digest: 'sha256:runner', kind: 'runner' as const, name: 'Runner 程序', platform: 'any',
      gitCommit: 'local', status: 'published' as const, publishedAt: '', signature: '', usedBy: 0 }
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([common,
      { ...common, digest: 'sha256:processor', kind: 'processor', name: '网页处理程序' },
      { ...common, digest: 'sha256:script', kind: 'script', name: '流程业务代码' }])
    const wrapper = mount(RunnerManagementTab, { props: { section: 'releases' }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).toContain('Runner 程序')
    expect(wrapper.text()).not.toContain('网页处理程序')
    expect(wrapper.text()).not.toContain('流程业务代码')
    wrapper.unmount()
  })

  it('Runner 版本的发布入口只调用 Runner 发布接口并刷新列表', async () => {
    useAuthStore().roles = ['admin']
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const publish = vi.spyOn(runnerManagementApi, 'publishRunner').mockResolvedValue({ digest: 'sha256:runner', created: true })
    const processor = vi.spyOn(runnerManagementApi, 'publishProcessor')
    const wrapper = mount(RunnerManagementTab, { props: { section: 'releases' }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('生成处理程序版本')
    expect(wrapper.text()).not.toContain('连接测试程序')
    expect(wrapper.text()).not.toContain('网页列表抓取')
    await wrapper.findAll('button').find(item => item.text() === '生成 Runner 版本')!.trigger('click'); await flushPromises()
    expect(publish).toHaveBeenCalledOnce()
    expect(processor).not.toHaveBeenCalled()
    expect(runnerManagementApi.releases).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
  it('同 IP 不同目录分别展示，不把实例按 IP 合并', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = await render()
    await flushPromises()
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('runner-prod')
    expect(rows[1]!.text()).toContain('runner-test')
    wrapper.unmount()
  })
  it('显示 Runner 上报的系统类型与版本，旧实例保留平台类型并提示版本未上报', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, platform: 'win32', osType: 'Windows', osVersion: '11 Professional · 10.0.22631' }, { ...instances[1]!, platform: 'linux' }])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = await render(); await flushPromises()
    expect(wrapper.findAll('th').map(cell => cell.text())).toContain('操作系统')
    const cells = wrapper.findAll('[data-testid="runner-os"]')
    expect(cells[0]!.text()).toContain('Windows'); expect(cells[0]!.text()).toContain('10.0.22631')
    expect(cells[1]!.text()).toContain('Linux'); expect(cells[1]!.text()).toContain('版本未上报')
    await wrapper.get('input[placeholder="IP、目录、实例名"]').setValue('22631')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    wrapper.unmount()
  })

  it('接口不可用时显示真实错误，不使用演示实例', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockRejectedValue(new Error('服务未部署'))
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = await render()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('服务未部署')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('runner-prod')
    wrapper.unmount()
  })

  it('运行机器展示 Runner 心跳版本和升级目标，源码运行显示本地源码', async () => {
    const actual = 'sha256:' + 'a'.repeat(64), desired = 'sha256:' + 'b'.repeat(64)
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, actualDigest: actual, desiredDigest: desired }, { ...instances[1]!, actualDigest: 'source-local', desiredDigest: null }])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = await render(); await flushPromises()
    expect(wrapper.findAll('th').map(item => item.text())).toContain('Runner 版本')
    const versions = wrapper.findAll('[data-testid="runner-version"]')
    expect(versions[0]!.text()).toContain('当前：aaaaaaaaaaaa')
    expect(versions[0]!.text()).toContain('目标：bbbbbbbbbbbb')
    expect(versions[0]!.get('span').attributes('title')).toContain(actual)
    expect(versions[1]!.text()).toContain('本地源码（source-local）')
    expect(versions[1]!.text()).toContain('目标：未设置')
    wrapper.unmount()
  })

  it('设置版本仅提供已发布 Runner 制品，提交完整 Runner 摘要', async () => {
    useAuthStore().roles = ['admin']
    const release: ArtifactRelease = { digest: 'sha256:' + 'c'.repeat(64), kind: 'runner', name: 'native-runner', platform: 'win32', gitCommit: 'local', status: 'published', publishedAt: '', signature: '', usedBy: 0 }
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, actualDigest: 'source-local', desiredDigest: null }])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([release, { ...release, digest: 'processor', kind: 'processor', name: '处理程序' }, { ...release, digest: 'script', kind: 'script', name: '业务代码' }, { ...release, digest: 'candidate', status: 'candidate', name: '未发布 Runner' }])
    const desired = vi.spyOn(runnerManagementApi, 'setDesiredRunner').mockResolvedValue({ runnerId: 'r-1', digest: release.digest })
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { stubs: assignmentStubs, directives: { loading: {} } } })
    await flushPromises()
    await wrapper.findAll('button').find(item => item.text() === '设置 Runner 版本')!.trigger('click')
    const choice = wrapper.get('[data-testid="runner-upgrade-version"]')
    expect(choice.findAll('option').filter(item => item.attributes('value'))).toHaveLength(1)
    expect(choice.text()).toContain('native-runner')
    expect(choice.text()).not.toContain('处理程序')
    expect(choice.text()).not.toContain('业务代码')
    expect(choice.text()).not.toContain('未发布 Runner')
    await choice.setValue(release.digest)
    await wrapper.findAll('button').find(item => item.text() === '应用升级')!.trigger('click'); await flushPromises()
    expect(desired).toHaveBeenCalledWith('r-1', release.digest)
    wrapper.unmount()
  })

  it('列表展示 Runner PID，详情按任务队列展示每个并发进程 PID', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue([{ ...instances[0]!, runnerPid: 7788, workerProcesses: [
      { assignmentId: 'a-1', queue: 'news_list', slot: 0, pid: 9001 },
      { assignmentId: 'a-1', queue: 'news_list', slot: 1, pid: 9002 },
    ] }])
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus], stubs: { ElDrawer: assignmentStubs.ElDrawer } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="runner-pid"]').text()).toBe('PID：7788')
    expect(wrapper.text()).toContain('2 个进程')
    await wrapper.findAll('button').find(item => item.text() === '详情')!.trigger('click')
    const panel = wrapper.get('[data-testid="runner-process-detail"]')
    expect(panel.text()).toContain('news_list')
    expect(panel.text()).toContain('9001')
    expect(panel.text()).toContain('9002')
    // 刷新后详情使用新的心跳快照，而不是打开时的旧对象。
    vi.mocked(runnerManagementApi.instances).mockResolvedValue([{ ...instances[0]!, runnerPid: 7799, workerProcesses: [] }])
    await wrapper.findAll('button').find(item => item.text() === '刷新')!.trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="runner-pid"]').text()).toBe('PID：7799')
    expect(wrapper.get('[data-testid="runner-process-detail"]').text()).toContain('最近心跳未上报存活的任务进程')
    wrapper.unmount()
  })

  it('旧版 Runner 不把缺少的进程报告解释为零个进程', async () => {
    vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
    vi.spyOn(runnerManagementApi, 'releases').mockResolvedValue([])
    const wrapper = mount(RunnerManagementTab, { props: { section: 'runners' }, global: { plugins: [ElementPlus], stubs: { ElDrawer: assignmentStubs.ElDrawer } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="runner-pid"]').text()).toBe('PID：未上报')
    expect(wrapper.text()).not.toContain('0 个进程')
    await wrapper.findAll('button').find(item => item.text() === '详情')!.trigger('click')
    expect(wrapper.get('[data-testid="runner-process-detail"]').text()).toContain('请更新 Runner')
    wrapper.unmount()
  })
})

const code: SiteCodeVersion & { environments: ('test' | 'prd')[] } = {
  codeId: 'code-1', configId: 'c-1', queueName: 'news_list', siteHost: 'www.realcan.cn',
  storagePath: 'code/c-1/code-1.py', deliveryPath: 'sites/www.realcan.cn.py', gitUrl: '', gitCommit: 'a'.repeat(40),
  scriptDigest: 'sha256:node-code', publishedAt: '', prompt: '', url: '', repoId: 'repo-1', repoName: '网页代码仓库', environments: [],
}
const assigned: QueueAssignment = { assignmentId: 'a-1', runnerId: 'r-2', queue: code.queueName, processorType: 'newslink_nourl',
  releaseDigest: 'sha256:processor', concurrency: 3, environment: 'production', enabled: true,
  codeId: code.codeId, configId: code.configId, scriptDigest: code.scriptDigest, deliveryPath: code.deliveryPath, repoName: code.repoName || '', gitCommit: code.gitCommit }
const assignmentStubs = {
  ElButton: { props: ['disabled'], template: '<button type="button" :disabled="disabled"><slot /></button>' },
  ElInput: { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
  ElSelect: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<select :value="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="" /><slot /></select>' },
  ElOption: { props: ['value', 'label'], template: '<option :value="value">{{ label }}</option>' },
  ElInputNumber: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<input type="number" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', Number($event.target.value))" />' },
  ElDialog: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>' },
  ElDrawer: { props: ['modelValue'], template: '<div v-if="modelValue"><slot /></div>' },
}
async function renderAssignments() {
  useAuthStore().roles = ['admin']
  vi.spyOn(runnerManagementApi, 'instances').mockResolvedValue(instances)
  vi.spyOn(runnerManagementApi, 'assignments').mockResolvedValue([])
  vi.spyOn(runnerManagementApi, 'siteCodeCatalog').mockResolvedValue([code])
  const wrapper = mount(RunnerManagementTab, { props: { section: 'assignments' }, global: { stubs: assignmentStubs, directives: { loading: {} } } })
  await flushPromises()
  return wrapper
}

describe('队列分配页面', () => {
  it('同一运行代码的历史版本不重复列出，切换环境自动使用该环境采用版本', async () => {
    const wrapper = await renderAssignments()
    const older = { ...code, scriptDigest: 'sha256:older', environments: ['test' as const] }
    vi.mocked(runnerManagementApi.siteCodeCatalog).mockResolvedValue([{ ...code, environments: ['prd'] }, older])
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    const choice = wrapper.get('[data-testid="assignment-node-code"]')
    expect(choice.findAll('option').filter(option => option.attributes('value'))).toHaveLength(1)
    await choice.setValue(older.scriptDigest)
    await wrapper.get('[data-testid="assignment-environment"]').setValue('production')
    expect((choice.element as HTMLSelectElement).value).toBe(code.scriptDigest)
    wrapper.unmount()
  })
  it('已有队列可以直接进入对应配置的运行版本', async () => {
    const wrapper = await renderAssignments()
    vi.mocked(runnerManagementApi.assignments).mockResolvedValue([assigned])
    await wrapper.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '运行版本')!.trigger('click')
    expect(wrapper.emitted('manageVersions')).toEqual([[code.configId]])
    wrapper.unmount()
  })
  it('在列表新增一行，选择节点代码后自动显示队列，无独立版本选择', async () => {
    const wrapper = await renderAssignments()
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    expect(wrapper.find('[data-testid="assignment-new-row"]').exists()).toBe(true)
    expect(wrapper.find('.el-dialog').exists()).toBe(false)
    expect(wrapper.get('[data-testid="assignment-node-code"]').text()).toContain('news_list · #c-1 · www.realcan.cn')
    await wrapper.get('[data-testid="assignment-node-code"]').setValue(code.scriptDigest)
    expect(wrapper.get('[data-testid="assignment-selected-queue"]').text()).toBe(code.queueName)
    expect(wrapper.text()).not.toContain('发布版本')
    expect(wrapper.text()).not.toContain('版本摘要')
    wrapper.unmount()
  })

  it('只提交所选节点代码与实例、环境和并发，保存后显示代码关联', async () => {
    const wrapper = await renderAssignments()
    vi.mocked(runnerManagementApi.assignments).mockResolvedValue([assigned])
    const create = vi.spyOn(runnerManagementApi, 'createAssignment').mockResolvedValue(assigned)
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    await wrapper.get('[data-testid="assignment-node-code"]').setValue(code.scriptDigest)
    await wrapper.get('[data-testid="assignment-runner"]').setValue('r-2')
    await wrapper.get('[data-testid="assignment-environment"]').setValue('production')
    await wrapper.get('[data-testid="assignment-concurrency"]').setValue(3)
    await wrapper.get('[data-testid="assignment-save"]').trigger('click')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({ runnerId: 'r-2', scriptDigest: code.scriptDigest, concurrency: 3, environment: 'production' })
    expect(wrapper.find('[data-testid="assignment-new-row"]').exists()).toBe(false)
    expect(wrapper.find('tbody tr').text()).toContain('#c-1 · sites/www.realcan.cn.py')
    expect(wrapper.find('tbody tr').text()).toContain('D:\\runner-test')
    wrapper.unmount()
  })

  it('缺少必选项或接口失败时保留新增行和填写内容', async () => {
    const wrapper = await renderAssignments()
    const create = vi.spyOn(runnerManagementApi, 'createAssignment').mockRejectedValue(new Error('该实例已分配此队列'))
    await wrapper.get('[data-testid="assignment-create"]').trigger('click')
    await wrapper.get('[data-testid="assignment-save"]').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('请选择运行代码和运行机器')
    expect(create).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="assignment-node-code"]').setValue(code.scriptDigest)
    await wrapper.get('[data-testid="assignment-runner"]').setValue('r-1')
    await wrapper.get('[data-testid="assignment-save"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('该实例已分配此队列')
    expect(wrapper.get('[data-testid="assignment-selected-queue"]').text()).toBe(code.queueName)
    await wrapper.get('[data-testid="assignment-cancel"]').trigger('click')
    expect(wrapper.find('[data-testid="assignment-new-row"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
