// @vitest-environment jsdom
// 源详情抽屉：0804 修复——父级复用同一个抽屉实例时，只切换 sourceId（modelValue 一直是 true）
// 不会触发重新加载，导致切换到另一条源后内容还是空的/停在上一条。
import { describe, expect, it, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import ElementPlus from 'element-plus'
import SourceDetailDrawer from './SourceDetailDrawer.vue'
import { sourceApi, type Source } from '../../api'

const SOURCE_A: Source = {
  sourceId: 'src-a', name: '源 A', url: 'http://a', configId: 'c-a', mainTable: 't-a',
  owner: 'dev_a', categoryPath: '/x/a', cycle: '每日', state: 'C', dataCount: 1,
}
const SOURCE_B: Source = {
  sourceId: 'src-b', name: '源 B', url: 'http://b', configId: 'c-b', mainTable: 't-b',
  owner: 'dev_b', categoryPath: '/x/b', cycle: '每日', state: 'C', dataCount: 2,
}

afterEach(() => vi.restoreAllMocks())

describe('SourceDetailDrawer', () => {
  // 父级（DataView/index.vue）是常驻挂载这个组件、用 v-model 切 modelValue 来开关，
  // 初始值恒为 false，所以测试也从 false 开始，走一遍真实的打开流程。
  it('首次打开（false→true）：按 sourceId 加载详情', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE_A)
    const wrapper = mount(SourceDetailDrawer, {
      global: { plugins: [ElementPlus] },
      props: { modelValue: false, sourceId: '' },
    })
    await wrapper.setProps({ modelValue: true, sourceId: 'src-a' })
    await flushPromises()

    expect(sourceApi.sourceDetail).toHaveBeenCalledWith('src-a')
    expect(wrapper.text()).toContain('源 A')
  })

  it('抽屉保持打开时切换 sourceId：重新拉取新源的详情，不停留在旧数据/空白', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockImplementation(async (id: string) =>
      id === 'src-a' ? SOURCE_A : SOURCE_B,
    )
    const wrapper = mount(SourceDetailDrawer, {
      global: { plugins: [ElementPlus] },
      props: { modelValue: false, sourceId: '' },
    })
    await wrapper.setProps({ modelValue: true, sourceId: 'src-a' })
    await flushPromises()
    expect(wrapper.text()).toContain('源 A')

    // modelValue 全程保持 true，只切 sourceId——这正是父级复用同一个抽屉实例时的真实场景
    await wrapper.setProps({ sourceId: 'src-b' })
    await flushPromises()

    expect(sourceApi.sourceDetail).toHaveBeenCalledWith('src-b')
    expect(wrapper.text()).toContain('源 B')
    expect(wrapper.text()).not.toContain('源 A')
  })

  // REVIEW-2026-08-04 P2 #7：兜底分支——父级误传空 sourceId 时应当弹错误提示并自动关抽屉，
  // 不调 sourceApi.sourceDetail，避免拿空串打接口。
  it('打开时 sourceId 为空：弹错误提示 + 自动 emit 关闭抽屉 + 不调 sourceDetail', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: () => {} }))
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE_A)
    const wrapper = mount(SourceDetailDrawer, {
      global: { plugins: [ElementPlus] },
      props: { modelValue: false, sourceId: '' },
    })
    // 父级把抽屉开了但忘了传 sourceId
    await wrapper.setProps({ modelValue: true, sourceId: '' })
    await flushPromises()

    expect(sourceApi.sourceDetail).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('请先选择源ID'))
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })
})
