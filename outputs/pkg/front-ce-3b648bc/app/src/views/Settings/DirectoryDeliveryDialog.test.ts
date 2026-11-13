// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import { runnerManagementApi, type DirectoryDelivery, type DirectoryDeliveryPreview } from '@/api/runnerManagement'
import DirectoryDeliveryDialog from './DirectoryDeliveryDialog.vue'

vi.mock('@/api/runnerManagement', () => ({ runnerManagementApi: { directoryDeliveryPreview: vi.fn(), deliverDirectoryBinding: vi.fn() } }))
vi.mock('element-plus', async (importOriginal) => ({ ...await importOriginal<typeof import('element-plus')>(), ElMessage: { success: vi.fn(), info: vi.fn() } }))
const binding = { bindingType: 'custom' as const, ownerId: 'shared', runnerId: 'r1', directoryTemplate: 'shared', entryPoint: '', createdAt: '' }
const preview: DirectoryDeliveryPreview = { revision: 'layout1', baselineDigest: 'sha256:base', targetPath: 'shared', items: [
  { path: 'main.py', kind: 'file', size: 30, status: 'modified', sha256: 'a'.repeat(64), previousSha256: 'b'.repeat(64) },
  { path: 'helper.py', kind: 'file', size: 70, status: 'unchanged', sha256: 'c'.repeat(64), previousSha256: 'c'.repeat(64) },
] }
const delivery: DirectoryDelivery = { deliveryId: 'd1', bindingType: 'custom', ownerId: 'shared', runnerId: 'r1', status: 'pending',
  layoutRevision: 'layout1', artifactDigest: 'sha256:delta', targetPath: 'shared', installedPath: '', requestedAt: '', startedAt: null, finishedAt: null, error: '', transferredFileCount: 1, unchangedFileCount: 1 }
beforeEach(() => {
  vi.mocked(runnerManagementApi.directoryDeliveryPreview).mockResolvedValue(structuredClone(preview))
  vi.mocked(runnerManagementApi.deliverDirectoryBinding).mockResolvedValue(structuredClone(delivery))
})
afterEach(() => { vi.resetAllMocks(); document.body.innerHTML = '' })
async function setup() {
  const wrapper = mount(DirectoryDeliveryDialog, { props: { binding, runnerName: '一号机器' }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}
it('展示文件 hash 与历史 hash，整个目录也只统计变更文件的传输量', async () => {
  const wrapper = await setup()
  expect(wrapper.get('[data-path="main.py"] [data-testid="delivery-file-hash"]').text()).toBe('a'.repeat(12))
  expect(wrapper.get('[data-path="main.py"] [data-testid="delivery-file-hash"]').attributes('title')).toContain('上次：' + 'b'.repeat(64))
  expect(wrapper.get('[data-testid="delivery-count"]').text()).toContain('需传 1 个文件 · 30 B')
  expect(wrapper.find('[data-path="helper.py"]').exists()).toBe(false)
  wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'all'); await flushPromises()
  expect(wrapper.get('[data-testid="delivery-count"]').text()).toContain('跳过 1 个未变文件')
  expect(wrapper.find('[data-path="helper.py"]').exists()).toBe(true)
  await wrapper.get('[data-testid="delivery-submit"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deliverDirectoryBinding).toHaveBeenCalledWith({ bindingType: 'custom', ownerId: 'shared', runnerId: 'r1',
    revision: 'layout1', scope: 'all', paths: undefined, baselineDigest: 'sha256:base' })
  expect(ElMessage.success).toHaveBeenCalledWith('下发任务已提交，传输 1 个变更文件，等待 Runner 完成')
  wrapper.unmount()
})
it('未变文件不默认勾选，整个目录返回未变化时显示无需下发', async () => {
  vi.mocked(runnerManagementApi.directoryDeliveryPreview).mockResolvedValue({ ...preview, items: preview.items.map(item => ({ ...item, status: 'unchanged' })) })
  vi.mocked(runnerManagementApi.deliverDirectoryBinding).mockResolvedValue({ ...delivery, status: 'success', unchanged: true, transferredFileCount: 0 })
  const wrapper = await setup()
  expect(wrapper.get('[data-testid="delivery-submit"]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('[data-testid="delivery-count"]').text()).toContain('文件 hash 未变化，无需下发')
  expect(wrapper.text()).toContain('暂无变更文件，无需下发')
  expect(wrapper.findAll('[data-path]')).toHaveLength(0)
  wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'all'); await flushPromises()
  await wrapper.get('[data-testid="delivery-submit"]').trigger('click'); await flushPromises()
  expect(ElMessage.info).toHaveBeenCalledWith('文件 hash 未变化，无需下发')
  expect(ElMessage.success).not.toHaveBeenCalled()
  expect(wrapper.emitted('delivered')?.[0]?.[0]).toMatchObject({ unchanged: true })
  wrapper.unmount()
})
it('变更视图仅保留变化文件及祖先目录，勾选文件夹不会选中隐藏的未变文件', async () => {
  vi.mocked(runnerManagementApi.directoryDeliveryPreview).mockResolvedValue({ ...preview, items: [
    { path: 'src', kind: 'folder', status: 'unchanged', size: 0 },
    { ...preview.items[0]!, path: 'src/main.py' },
    { ...preview.items[1]!, path: 'src/helper.py' },
    { path: 'assets', kind: 'folder', status: 'unchanged', size: 0 },
    { ...preview.items[1]!, path: 'assets/logo.png' },
  ] })
  const wrapper = await setup()
  expect(wrapper.find('[data-path="src"]').exists()).toBe(true)
  const folderNode = wrapper.get('[data-path="src"]').element.closest('.el-tree-node')!
  expect(folderNode.getAttribute('aria-expanded')).toBe('false')
  folderNode.querySelector<HTMLElement>('.el-tree-node__expand-icon')!.click(); await flushPromises()
  expect(wrapper.find('[data-path="src/main.py"]').exists()).toBe(true)
  expect(wrapper.find('[data-path="src/helper.py"]').exists()).toBe(false)
  expect(wrapper.find('[data-path="assets"]').exists()).toBe(false)
  expect(wrapper.find('[data-path="src"] .el-tag').exists()).toBe(false)
  // Toggle the visible folder twice; changes mode must remain filtered.
  const checkbox = wrapper.get('[data-path="src"]').element.closest('.el-tree-node__content')!.querySelector('input')!
  await wrapper.getComponent({ name: 'ElTree' }).find('input').setValue(false)
  checkbox.click(); await flushPromises()
  expect(wrapper.find('[data-path="src/helper.py"]').exists()).toBe(false)
  await wrapper.get('[data-testid="delivery-submit"]').trigger('click'); await flushPromises()
  expect(runnerManagementApi.deliverDirectoryBinding).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'selected', paths: ['src/main.py'] }))
  wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'selected'); await flushPromises()
  expect(wrapper.find('[data-path="src/helper.py"]').exists()).toBe(true)
  expect(wrapper.find('[data-path="assets"]').exists()).toBe(true)
  wrapper.unmount()
})
