// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Source, Step } from '@/api'
import GenerationFlowPicker from './GenerationFlowPicker.vue'

it('按真实拓扑显示分支及配置，点击卡片多选，停用和无配置节点保留但不能勾选', async () => {
  const nodes = [
    { stepId: '1', configId: '101', name: '网页抓取', enabled: true, isRoot: true, dependsOn: ['0'] },
    { stepId: '2', configId: '102', name: '文件下载', enabled: true, dependsOn: ['1'] },
    { stepId: '3', configId: '103', name: '停用节点', enabled: false, dependsOn: ['1'] },
    { stepId: '4', name: '未配置节点', enabled: true, dependsOn: ['2'] },
  ] as Step[]
  const w = mount(GenerationFlowPicker, { props: { source: { sourceId: '7', name: '新闻' } as Source, nodes, modelValue: [] } })
  expect(w.findAll('[role="checkbox"]')).toHaveLength(4)
  expect(w.findAll('.pnr-edge').length).toBeGreaterThanOrEqual(3)
  expect(w.text()).toContain('配置 101')
  expect(w.text()).toContain('配置 未绑定')
  expect(w.get('[data-node-id="3"]').attributes('aria-disabled')).toBe('true')
  expect(w.get('[data-node-id="4"]').attributes('aria-disabled')).toBe('true')
  await w.get('[data-node-id="1"]').trigger('click')
  expect(w.emitted('update:modelValue')?.at(-1)).toEqual([['1']])
  await w.setProps({ modelValue: ['1'] })
  await w.get('[data-node-id="2"]').trigger('click')
  expect(w.emitted('update:modelValue')?.at(-1)).toEqual([['1', '2']])
  await w.get('[data-node-id="3"]').trigger('click')
  expect(w.emitted('update:modelValue')).toHaveLength(2)
  await w.findAll('button').find(button => button.text() === '全选节点')!.trigger('click')
  expect(w.emitted('update:modelValue')?.at(-1)).toEqual([['1', '2']])
  w.unmount()
})
