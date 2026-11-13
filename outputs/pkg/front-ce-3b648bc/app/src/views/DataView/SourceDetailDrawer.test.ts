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
  owner: 'dev_a', category: '新闻', subCategory: '公告', categoryPath: '/x/a', dirId: 'dir-a', domain: 'a.test',
  tags: ['重点'], cycle: '每日', state: 'C', dataCount: 1, newInCount: 2, successCount: 1,
  resume: true, authConfig: 'login-a', priority: 1, coreParam: 'code', lastUrl: 'http://a/last',
  updatedAt: '2026-08-11 10:00',
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
    // 标签按旧平台原样：「配置ID」无空格、「登陆配置」不是「登录配置」（2026-10-16 对齐 SOURCE 详情字段）
    expect(wrapper.text()).toContain('配置ID')
    expect(wrapper.text()).toContain('登陆配置')
    expect(wrapper.text()).toContain('目录路径')
    expect(wrapper.text()).not.toContain('配置 ID')
  })

  // 2026-10-16：旧 `page/base/detail/SourceDetail.vue` 不自写模板，它把
  // `allColumns.SOURCE.BASE + SOURCE.OTHER` 里未标 noDetail 的列交给 BaseDetail 渲染成
  // `<a-descriptions :column="4" bordered>`。这里逐项钉住那份清单，防止再"对不上"。
  it('字段清单逐项对齐旧平台 SOURCE 详情（descriptions 表格形式）', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE_A)
    const wrapper = mount(SourceDetailDrawer, {
      global: { plugins: [ElementPlus] },
      props: { modelValue: false, sourceId: '' },
    })
    await wrapper.setProps({ modelValue: true, sourceId: 'src-a' })
    await flushPromises()

    const EXPECTED_LABELS = [
      // SOURCE.BASE（去掉 noDetail 的「数据 / 定时 / 步骤 / 操作」）
      '源ID', '名称', 'URL', '配置ID', '流程ID', '最新', '主表', '断点续传', '域',
      // SOURCE.OTHER
      '大类', '数量', '登陆配置', '上次URL', '目录', '目录路径', '核心参数',
      '子类别', '标签', '责任人', '备注', '优先级', '禁用', '日期', '更新时间', '状态', '上次任务', '上次成功',
    ]
    const text = wrapper.text()
    for (const label of EXPECTED_LABELS) {
      expect(text, `字段「${label}」缺失`).toContain(label)
    }

    // 旧版标了 noDetail 的两列不该出现在详情里（「数据」是 BASE 里被排除的那一项）
    expect(text).not.toContain('定时')
    expect(text).not.toContain('步骤')

    // 排布与旧版一致：4 列的 bordered descriptions（label / value 表格）
    // 排布与旧版一致：4 列的 bordered descriptions（label / value 表格）。
    // EP 的 border 不落根节点 class，而是打在单元格上（is-bordered-label / is-bordered-content）。
    expect(wrapper.find('.el-descriptions').exists()).toBe(true)
    expect(wrapper.findAll('.el-descriptions__label')).toHaveLength(EXPECTED_LABELS.length)
    expect(wrapper.get('.el-descriptions__label').classes()).toContain('is-bordered-label')
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

  // 2026-10-16：旧 `column.config` 里 remark 是唯一带 save 回调的列（span 4 独占一行 + textarea +
  // 三态保存按钮）。新端补上这条逻辑——保存体必须照旧带上 author / tags，否则会把这两个字段清空。
  it('备注可编辑：保存时按旧口径带上 author / tags，成功后进「已保存」态', async () => {
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE_A)
    const update = vi.spyOn(sourceApi, 'updateSource').mockResolvedValue({ ok: true, message: '操作成功' })
    const wrapper = mount(SourceDetailDrawer, {
      global: { plugins: [ElementPlus] },
      props: { modelValue: false, sourceId: '' },
    })
    await wrapper.setProps({ modelValue: true, sourceId: 'src-a' })
    await flushPromises()

    // 渲染成 textarea（可编辑），不是一行纯文本。
    // 注意：ElInput 是 inheritAttrs:false，data-testid 会落到内部 <textarea> 本身，不是外层 div。
    const input = wrapper.get('textarea[data-testid="source-remark-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('')

    await input.setValue('补充说明')
    await wrapper.get('[data-testid="source-remark-save"]').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith({
      sourceId: 'src-a',
      remark: '补充说明',
      author: 'dev_a',
      tags: '重点',
    })
    expect(wrapper.get('[data-testid="source-remark-save"]').text()).toContain('已保存')
  })

  it('备注保存失败：报错提示，按钮不进入「已保存」', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: () => {} }))
    vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(SOURCE_A)
    vi.spyOn(sourceApi, 'updateSource').mockResolvedValue({ ok: false, message: '无权限' })
    const wrapper = mount(SourceDetailDrawer, {
      global: { plugins: [ElementPlus] },
      props: { modelValue: false, sourceId: '' },
    })
    await wrapper.setProps({ modelValue: true, sourceId: 'src-a' })
    await flushPromises()

    await wrapper.get('[data-testid="source-remark-save"]').trigger('click')
    await flushPromises()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('保存失败'))
    expect(wrapper.get('[data-testid="source-remark-save"]').text()).not.toContain('已保存')
  })
})
