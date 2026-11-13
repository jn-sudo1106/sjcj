// @vitest-environment jsdom
// 源选择器（EntrySourceSelect）—— 旧 `data-view/src/page/base/SourceSelect.vue` 的等价物。
//
// 这一轮修了三处偏离旧版的地方（详情按钮图标/提示、「更多源...」的 mousedown 处理、
// 「更多源」带回来的 configId），三个都是「看不出来但会坏事」的类型，所以逐个钉死；
// 另外把「下拉候选的取数口径」也固定住（旧 `getSourceSame(sid)`，没给 sid 就不请求）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import EntrySourceSelect from './EntrySourceSelect.vue'
import { sourceApi, type Source } from '@/api'

const spies = vi.hoisted(() => ({
  moreOpen: vi.fn(),
  detailOpen: vi.fn(),
}))

// 两个弹层换成替身：真弹窗是 teleport + 过渡，jsdom 里断言不到「被打开」，
// 而这里要验的是「点哪个入口、用什么参数打开的它」。
vi.mock('./MoreSourcesDialog.vue', () => ({
  default: defineComponent({
    name: 'MoreSourcesDialog',
    emits: ['selected'],
    setup(_props, { expose }) {
      expose({ open: spies.moreOpen })
      return () => h('div', { class: 'stub-more' })
    },
  }),
}))

vi.mock('./SourceDetailDialog.vue', () => ({
  default: defineComponent({
    name: 'SourceDetailDialog',
    setup(_props, { expose }) {
      expose({ open: spies.detailOpen })
      return () => h('div', { class: 'stub-source-detail' })
    },
  }),
}))

const SAME: Source[] = [
  { sourceId: '161725', name: '招商中证白酒', url: '', configId: '70598', mainTable: 't1', owner: 'u', state: 'C' },
  { sourceId: '161726', name: '新浪财经', url: '', configId: '70599', mainTable: 't2', owner: 'u', state: 'C' },
] as Source[]

let sourceSame: ReturnType<typeof vi.spyOn>

function mountSelect(props: Record<string, unknown> = {}, modelValue?: string) {
  return mount(EntrySourceSelect, {
    attachTo: document.body,
    props: { modelValue, ...props },
    global: { plugins: [ElementPlus] },
  })
}

/** 打开 el-select 的下拉（`#footer` 是懒渲染的，不打开就查不到） */
async function openDropdown(w: VueWrapper) {
  const trigger = w.find('.el-select__wrapper').exists() ? '.el-select__wrapper' : '.select-trigger'
  await w.find(trigger).trigger('click')
  await nextTick()
  await flushPromises()
  const footer = document.body.querySelector('.ess-more') as HTMLElement | null
  if (!footer) throw new Error('下拉未渲染「更多源...」')
  return footer
}

beforeEach(() => {
  Object.values(spies).forEach((fn) => fn.mockClear())
  sourceSame = vi.spyOn(sourceApi, 'sourceSame').mockResolvedValue(SAME.map((s) => ({ sourceId: s.sourceId, name: s.name })))
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('EntrySourceSelect · 下拉候选', () => {
  it('没给 sid 就不请求（旧 `loadData` 第一行 `if (!this.sid) return`）', async () => {
    const w = mountSelect()
    await flushPromises()
    expect(sourceSame).not.toHaveBeenCalled()
    w.unmount()
  })

  it('给了 sid → 调 sourceSame(sid)，候选项 label 是 `[源ID]名称`', async () => {
    const w = mountSelect({ sid: '161725' })
    await flushPromises()
    expect(sourceSame).toHaveBeenCalledWith('161725')
    const labels = w.findAllComponents({ name: 'ElOption' }).map((o) => o.props('label'))
    expect(labels).toEqual(['[161725]招商中证白酒', '[161726]新浪财经'])
    w.unmount()
  })

  it('sourceSame 失败时静默（旧版 catch 里只有注释掉的 notification）', async () => {
    sourceSame.mockRejectedValue(new Error('boom'))
    const w = mountSelect({ sid: '161725' })
    await flushPromises()
    expect(w.findAllComponents({ name: 'ElOption' })).toHaveLength(0)
    w.unmount()
  })

  it('选中 → emit change(该行记录)；清空 → emit change(null)', async () => {
    const w = mountSelect({ sid: '161725' })
    await flushPromises()
    w.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '161726')
    await flushPromises()
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['161726'])
    expect(w.emitted('change')?.at(-1)).toEqual([{ sourceId: '161726', name: '新浪财经' }])

    w.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '')
    await flushPromises()
    expect(w.emitted('change')?.at(-1)).toEqual([null])
    w.unmount()
  })
})

describe('EntrySourceSelect · 与旧版 DSourceSelect 的三处对齐', () => {
  it('源详情按钮：问号圆图标 + tooltip「源详情」（旧 question-circle + a-tooltip）', async () => {
    const w = mountSelect({ sid: '161725' })
    await flushPromises()
    const btn = w.find('.ess-detail-btn')
    expect(btn.exists()).toBe(true)
    // 图标组件来自 @element-plus/icons-vue 的 QuestionFilled（旧 `a-icon type="question-circle"`）
    expect(btn.findComponent({ name: 'ElIcon' }).exists()).toBe(true)
    // el-select 内部也用 el-tooltip，所以要按 content 找「包着详情按钮」的那个
    const tip = w.findAllComponents({ name: 'ElTooltip' }).find((t) => t.props('content') === '源详情')
    expect(tip).toBeTruthy()
    expect(tip?.find('.ess-detail-btn').exists()).toBe(true)
    w.unmount()
  })

  it('`detail=false` 时不渲染源详情按钮（旧 `v-if="detail"`）', async () => {
    const w = mountSelect({ sid: '161725', detail: false })
    await flushPromises()
    expect(w.find('.ess-detail-btn').exists()).toBe(false)
    w.unmount()
  })

  it('「更多源...」的 mousedown 被 preventDefault（否则 el-select 先失焦关掉下拉）', async () => {
    const w = mountSelect({ sid: '161725' })
    await flushPromises()
    const footer = await openDropdown(w)

    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    footer.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)

    footer.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(spies.moreOpen).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('「更多源」选中 → 补进候选、选中第一个，并把 configId 一起带进 change', async () => {
    // sourceSame 只给 sourceId/name；「更多源」弹窗回来的是 sourcePaged 的完整行
    const w = mountSelect({ sid: '161725' })
    await flushPromises()
    w.findComponent({ name: 'MoreSourcesDialog' }).vm.$emit('selected', [SAME[1]])
    await flushPromises()

    const labels = w.findAllComponents({ name: 'ElOption' }).map((o) => o.props('label'))
    expect(labels).toEqual(['[161725]招商中证白酒', '[161726]新浪财经'])
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['161726'])
    // 旧 `this.source.configId` 就是这条记录带出去的
    expect(w.emitted('change')?.at(-1)).toEqual([
      { sourceId: '161726', name: '新浪财经', configId: '70599' },
    ])
    w.unmount()
  })
})

describe('EntrySourceSelect · reloadSid / 源详情', () => {
  it('reloadSid：重拉同站源 + 主动选中 + emit change（旧 `reloadSid`）', async () => {
    const w = mountSelect()
    await flushPromises()
    expect(sourceSame).not.toHaveBeenCalled()

    await (w.vm as unknown as { reloadSid: (sid: string) => Promise<void> }).reloadSid('161726')
    await flushPromises()
    expect(sourceSame).toHaveBeenCalledWith('161726')
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['161726'])
    expect(w.emitted('change')?.at(-1)).toEqual([{ sourceId: '161726', name: '新浪财经' }])
    w.unmount()
  })

  it('reloadSid(空)：直接返回 —— 不请求、不动候选、不 emit（旧 `if (!sid) return`）', async () => {
    const w = mountSelect({ sid: '161725' })
    await flushPromises()
    sourceSame.mockClear()

    await (w.vm as unknown as { reloadSid: (sid: string) => Promise<void> }).reloadSid('')
    await flushPromises()
    expect(sourceSame).not.toHaveBeenCalled()
    expect(w.emitted('change')).toBeUndefined()
    // 候选还在（旧版也是「不清空」）
    expect(w.findAllComponents({ name: 'ElOption' })).toHaveLength(2)
    w.unmount()
  })

  it('源详情：没选源先提示；选了 → 用当前源 ID 打开详情', async () => {
    const err = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const w = mountSelect()
    await flushPromises()
    await w.find('.ess-detail-btn').trigger('click')
    expect(err).toHaveBeenCalledWith('请先选择源ID')
    expect(spies.detailOpen).not.toHaveBeenCalled()

    w.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '161725')
    await flushPromises()
    await w.find('.ess-detail-btn').trigger('click')
    expect(spies.detailOpen).toHaveBeenCalledWith('161725')
    w.unmount()
  })
})
