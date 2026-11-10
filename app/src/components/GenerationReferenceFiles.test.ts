// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElTree } from 'element-plus'
import { runnerManagementApi as api } from '@/api/runnerManagement'
import GenerationReferenceFiles from './GenerationReferenceFiles.vue'

afterEach(() => vi.restoreAllMocks())
it('在每个参考文件下显示资源对应的 Windows 或 Linux 输入文件完整路径', () => {
  const w = mount(GenerationReferenceFiles, { props: {
    modelValue: [{ repositoryId: 'repo', path: 'links/1401218/demo.py' }], repositories: [{ repoId: 'repo', name: '默认仓库' }] as never,
    inputLocations: [{ id: 'windows', label: 'Windows 智能体', directory: 'D:\\coder\\workspace\\1401218\\input' }, { id: 'linux', label: 'Linux 智能体', directory: '/data/workspace/1401218/input' }],
    locationHint: '待分配智能体',
  }, global: { plugins: [ElementPlus] } })
  expect(w.text()).toContain('默认仓库 / links/1401218/demo.py')
  expect(w.text()).toContain('D:\\coder\\workspace\\1401218\\input\\demo.py')
  expect(w.text()).toContain('/data/workspace/1401218/input/demo.py')
  expect(w.text()).toContain('待分配智能体')
  expect(w.findAll('[data-testid="reference-input-location"]')).toHaveLength(2)
  w.unmount()
})
it('从 Git 目录树多选参考文件，确认后保存仓库与相对路径', async () => {
  vi.spyOn(api, 'codeRepositoryTree').mockResolvedValue({ repoId: 'repo', gitCommit: 'abc', items: [
    { path: 'links', kind: 'directory', size: null, selectable: true },
    { path: 'links/1401218/demo.py', kind: 'file', size: 10, selectable: true },
    { path: 'links/1401218/helper.py', kind: 'file', size: 10, selectable: true },
  ] })
  const w = mount(GenerationReferenceFiles, { props: { modelValue: [], repositories: [{ repoId: 'repo', name: '默认仓库' }] as never }, global: { plugins: [ElementPlus], stubs: { ElDialog: { template: '<div><slot /><slot name="footer" /></div>' } } } })
  await w.get('[data-testid="select-generation-references"]').trigger('click'); await flushPromises()
  expect(api.codeRepositoryTree).toHaveBeenCalledWith('repo')
  expect(w.text()).toContain('demo.py')
  const tree = w.findComponent(ElTree)
  tree.vm.$emit('check', { path: 'links/1401218/demo.py', disabled: false }, { checkedKeys: ['links/1401218/demo.py'] })
  tree.vm.$emit('check', { path: 'links/1401218/helper.py', disabled: false }, { checkedKeys: ['links/1401218/demo.py', 'links/1401218/helper.py'] })
  await w.get('[data-testid="confirm-generation-references"]').trigger('click')
  expect(w.emitted('update:modelValue')).toEqual([[[{ repositoryId: 'repo', path: 'links/1401218/demo.py' }, { repositoryId: 'repo', path: 'links/1401218/helper.py' }]]])
  w.unmount()
})
