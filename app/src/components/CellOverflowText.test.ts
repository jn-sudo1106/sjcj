// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus, { ElTooltip } from 'element-plus'
import CellOverflowText from './CellOverflowText.vue'

function mockWidths(el: HTMLElement, clientWidth: number, scrollWidth: number) {
  Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true })
  Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true })
}

async function mountCell(text: string) {
  return mount(CellOverflowText, { props: { text }, global: { plugins: [ElementPlus] } })
}

it('渲染完整文本，未截断时不弹提示', async () => {
  const w = await mountCell('霍尔木兹海峡')
  const span = w.get('.cell-overflow-text')
  expect(span.text()).toBe('霍尔木兹海峡')
  mockWidths(span.element as HTMLElement, 120, 80)
  await span.trigger('mouseenter')
  expect(w.findComponent(ElTooltip).props('disabled')).toBe(true)
  w.unmount()
})

// 2026-11-25 用户反馈：数据中心业务列被省略号截断，鼠标移上去要能看全文。
it('文本被截断时悬停显示全文', async () => {
  const w = await mountCell('霍尔木兹海峡（伊朗一侧）封锁风险持续')
  const span = w.get('.cell-overflow-text')
  mockWidths(span.element as HTMLElement, 120, 320)
  await span.trigger('mouseenter')
  const tip = w.findComponent(ElTooltip)
  expect(tip.props('disabled')).toBe(false)
  expect(tip.props('content')).toBe('霍尔木兹海峡（伊朗一侧）封锁风险持续')
  w.unmount()
})

it('文本变化后重新量一次宽度', async () => {
  const w = await mountCell('短')
  const span = w.get('.cell-overflow-text')
  mockWidths(span.element as HTMLElement, 120, 40)
  await span.trigger('mouseenter')
  expect(w.findComponent(ElTooltip).props('disabled')).toBe(true)
  mockWidths(span.element as HTMLElement, 120, 200)
  await w.setProps({ text: '换成一段很长的指标名称看看' })
  await span.trigger('mouseenter')
  expect(w.findComponent(ElTooltip).props('disabled')).toBe(false)
  w.unmount()
})