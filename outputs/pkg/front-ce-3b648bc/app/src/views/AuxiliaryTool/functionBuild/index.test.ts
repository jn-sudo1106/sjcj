// @vitest-environment jsdom
// 函数工具页接线回归：点示例按钮要真的把「当前值 / 上下文 / 表达式 / 说明」四件套填进去，
// 点「计算」要带对三参发 comm/exp，并把 data 摊到结果框（而不是把整层信封 stringify）。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import FunctionBuild from './index.vue'
import { checkExp } from '@/api/exp'

vi.mock('@/api/exp', async () => {
  const actual = await vi.importActual<typeof import('@/api/exp')>('@/api/exp')
  return { ...actual, checkExp: vi.fn() }
})

const mockedCheck = vi.mocked(checkExp)

beforeEach(() => {
  mockedCheck.mockReset().mockResolvedValue({ ok: true, message: '操作成功', data: '600001.sh' })
})

function mountPage() {
  return mount(FunctionBuild, { global: { plugins: [ElementPlus] } })
}

describe('函数工具页', () => {
  it('五个分组都在左侧 tabs 里', () => {
    const wrapper = mountPage()
    const labels = wrapper.findAll('.el-tabs__item').map((item) => item.text())
    expect(labels).toEqual(['核心结构', '自定义函数', '字符串操作', '数学函数', '系统常量'])
  })

  it('点示例按钮填好四件套（带 env 的用自带上下文）', async () => {
    const wrapper = mountPage()
    await wrapper.findAll('.fb-item')[0]!.trigger('click')
    expect((wrapper.find('input[placeholder="值"]').element as HTMLInputElement).value).toBe('vvv')
    expect((wrapper.find('textarea[placeholder="上下文"]').element as HTMLTextAreaElement).value).toBe(
      "{'a': 1, 'b': 2, 'value': 'vvv'}",
    )
    expect((wrapper.find('textarea[placeholder="表达式"]').element as HTMLTextAreaElement).value).toBe(
      "a + b + '字符串' + value",
    )
    expect(wrapper.text()).toContain('上下文中 a加b')
  })

  it('点示例按钮（无 env）自动补 {"value": demo}', async () => {
    const wrapper = mountPage()
    // 第二个示例：if-else 结构，demo=600001，没有 env
    await wrapper.findAll('.fb-item')[1]!.trigger('click')
    expect((wrapper.find('textarea[placeholder="上下文"]').element as HTMLTextAreaElement).value).toBe(
      '{"value":"600001"}',
    )
  })

  it('计算：带 value / rule / env 三参，结果取 data', async () => {
    const wrapper = mountPage()
    await wrapper.findAll('.fb-item')[0]!.trigger('click')
    await wrapper.find('.fb-calc').trigger('click')
    await flushPromises()
    expect(mockedCheck).toHaveBeenCalledWith('vvv', "a + b + '字符串' + value", "{'a': 1, 'b': 2, 'value': 'vvv'}")
    expect((wrapper.find('input[placeholder="结果"]').element as HTMLInputElement).value).toBe('600001.sh')
  })
})
