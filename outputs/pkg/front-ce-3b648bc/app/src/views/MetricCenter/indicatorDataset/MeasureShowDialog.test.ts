// @vitest-environment jsdom
// 「指标」弹窗（MeasureShowDialog）—— 旧 `page/base/measure/MeasureShow.vue` 的等价物。
//
// 它本身不画任何东西，只是把「整页指标列表」塞进一个 a-modal 形态里，所以这里验三件事：
//   1. 懒渲染 —— 没 open 之前不挂指标列表（旧 `:destroyOnClose="true"`）；
//   2. 三个入参按旧 `showModal(sourceId, entryTypeId, datasetId)` 的顺序透传（顺序错了会拿错数据集）；
//   3. 宽度算法 = `document.body.clientWidth - 100`（旧版原文），窄环境兜 320px 的底。
import { describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ElementPlus from 'element-plus'
import MeasureShowDialog from './MeasureShowDialog.vue'

// 真组件是整页「指标列表」（自带左树 + 六条接口），这里只验弹窗有没有把它按对的入参挂起来。
vi.mock('../indicatorsList/index.vue', () => ({
  default: defineComponent({
    name: 'IndicatorsList',
    props: {
      sourceId: [String, Number],
      entryTypeId: [String, Number],
      datasetId: [String, Number],
    },
    setup() {
      return () => h('div', { class: 'stub-measure-list' })
    },
  }),
}))

const MOUNT_OPTIONS = {
  // teleport 桩掉：append-to-body 的内容否则会飞到 document.body 上，断言要绕一圈
  global: { plugins: [ElementPlus], stubs: { teleport: true } },
}

function mountDialog(): VueWrapper {
  return mount(MeasureShowDialog, MOUNT_OPTIONS)
}

async function open(w: VueWrapper, ...args: unknown[]): Promise<void> {
  ;(w.vm as unknown as { open: (...a: unknown[]) => void }).open(...args)
  await nextTick()
}

function list(w: VueWrapper) {
  return w.findComponent({ name: 'IndicatorsList' })
}

function dialogWidth(w: VueWrapper): unknown {
  return w.findComponent({ name: 'ElDialog' }).props('width')
}

describe('MeasureShowDialog · 懒渲染', () => {
  it('未 open 时不挂指标列表（旧 :destroyOnClose 的等价物：每次打开都重新挂载）', () => {
    const w = mountDialog()
    expect(w.findComponent({ name: 'ElDialog' }).props('modelValue')).toBe(false)
    expect(list(w).exists()).toBe(false)
  })

  it('open 后弹出弹窗并挂上指标列表', async () => {
    const w = mountDialog()
    await open(w, 161725, 1001, 1001)
    expect(w.findComponent({ name: 'ElDialog' }).props('modelValue')).toBe(true)
    expect(list(w).exists()).toBe(true)
  })
})

describe('MeasureShowDialog · 入参', () => {
  it('按旧 showModal(sourceId, entryTypeId, datasetId) 的顺序透传', async () => {
    const w = mountDialog()
    await open(w, 161725, 1001, 2002)
    expect(list(w).props()).toMatchObject({ sourceId: 161725, entryTypeId: 1001, datasetId: 2002 })
  })

  it('缺参时传 null（旧 showModal 不传就是 undefined），不会串到别的键上', async () => {
    const w = mountDialog()
    await open(w)
    expect(list(w).props()).toMatchObject({ sourceId: null, entryTypeId: null, datasetId: null })
  })

  it('每次 open 都重新挂载内嵌列表（关闭动画没走完就点下一行也不会复用上一条的实例）', async () => {
    const w = mountDialog()
    await open(w, 161725, 1001, 2002)
    const first = list(w).element
    await open(w, 161725, 1001, 3003)
    // 内嵌的指标列表只在 mounted 读一次 props，所以这里验的是「DOM 节点换了新的」= 真重建
    expect(list(w).element).not.toBe(first)
    expect(list(w).props()).toMatchObject({ datasetId: 3003 })
  })
})

describe('MeasureShowDialog · 宽度（旧 `document.body.clientWidth - 100`）', () => {
  it('按 clientWidth - 100 计算；窄环境（含 jsdom 的 0）兜 320px 的底', async () => {
    // jsdom 的 body.clientWidth 恒为 0 → 落到下限（旧版没下限，会算出 -100px）
    const w = mountDialog()
    await open(w, 1, 2, 3)
    expect(dialogWidth(w)).toBe('320px')
    w.unmount()

    Object.defineProperty(document.body, 'clientWidth', { value: 1680, configurable: true })
    try {
      const w2 = mountDialog()
      await open(w2, 1, 2, 3)
      expect(dialogWidth(w2)).toBe('1580px')
      w2.unmount()
    } finally {
      delete (document.body as unknown as { clientWidth?: number }).clientWidth
    }
  })
})
