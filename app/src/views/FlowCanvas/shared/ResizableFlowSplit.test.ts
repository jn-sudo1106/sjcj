// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ResizableFlowSplit from './ResizableFlowSplit.vue'

it('拖动与键盘调整分栏宽度，并限制左右区域的最小宽度', async () => {
  const wrapper = mount(ResizableFlowSplit)
  Object.defineProperty(wrapper.element, 'clientWidth', { value: 1000 })
  wrapper.element.getBoundingClientRect = () => ({ left: 100 } as DOMRect)
  const handle = wrapper.get('[data-testid="flow-split-handle"]')
  handle.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 460, bubbles: true }))
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 650 }))
  await wrapper.vm.$nextTick()
  expect(handle.attributes('aria-valuenow')).toBe('550')
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 990 }))
  await wrapper.vm.$nextTick()
  expect(handle.attributes('aria-valuenow')).toBe('610')
  window.dispatchEvent(new MouseEvent('pointerup'))
  await handle.trigger('keydown', { key: 'ArrowLeft' })
  expect(handle.attributes('aria-valuenow')).toBe('590')
  wrapper.unmount()
})

it('右侧配置区域可拖宽，也保留画布最小宽度', async () => {
  const wrapper = mount(ResizableFlowSplit, { props: { resizeSide: 'right', initialWidth: 270, minLeft: 150, minRight: 180, label: '调整节点配置宽度' } })
  Object.defineProperty(wrapper.element, 'clientWidth', { value: 700 })
  wrapper.element.getBoundingClientRect = () => ({ left: 100 } as DOMRect)
  const handle = wrapper.get('[aria-label="调整节点配置宽度"]')
  handle.element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 524, bubbles: true }))
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 }))
  await wrapper.vm.$nextTick()
  expect(handle.attributes('aria-valuenow')).toBe('394')
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 150 }))
  await wrapper.vm.$nextTick()
  expect(handle.attributes('aria-valuenow')).toBe('538')
  window.dispatchEvent(new MouseEvent('pointerup'))
  await handle.trigger('keydown', { key: 'ArrowRight' })
  expect(handle.attributes('aria-valuenow')).toBe('518')
  wrapper.unmount()
})
