// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import CronField from './CronField.vue'
import CronBuilder from './CronBuilder.vue'

// cron 单字段编辑器（迁移旧 components/Cron/tabs/* + CronMixin）
describe('CronField · cron 单字段编辑器', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  function mountField(props: Record<string, unknown>) {
    wrapper = mount(CronField, {
      attachTo: document.body,
      props: { modelValue: '*', unit: '分', min: 0, max: 59, ...props },
      global: { plugins: [ElementPlus] },
    })
    return wrapper
  }

  it('`*` → 勾选「每X」，`?` → 勾选「不设置」', async () => {
    const w = mountField({ modelValue: '*' })
    const checked = () => [...document.body.querySelectorAll('.el-radio.is-checked .el-radio__label')].map((el) => el.textContent?.trim())
    expect(checked()[0]).toBe('每分')

    await w.setProps({ modelValue: '?', allowNotSet: true })
    await flushPromises()
    expect(checked()[0]).toContain('不设置')
  })

  it('`5,10` 落到「指定」并勾上对应项；取消勾选后重新拼装', async () => {
    const w = mountField({ modelValue: '5,10' })
    await flushPromises()
    const boxes = [...document.body.querySelectorAll('.el-checkbox')] as HTMLElement[]
    const checkedTexts = boxes.filter((b) => b.classList.contains('is-checked')).map((b) => b.textContent?.trim())
    expect(checkedTexts).toEqual(['5', '10'])

    // 勾上 7 → 输出升序逗号列表
    const box7 = boxes.find((b) => b.textContent?.trim() === '7') as HTMLElement
    await box7.querySelector('input')!.click()
    await flushPromises()
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['5,7,10'])
  })

  it('区间/循环按旧口径拼装（`start-end` / `start/interval`）', async () => {
    const w = mountField({ modelValue: '1-10' })
    await flushPromises()
    expect((w.emitted('update:modelValue')?.at(-1)?.[0] as string)).toBe('1-10')

    await w.setProps({ modelValue: '0/15' })
    await flushPromises()
    // 循环态：区间与循环各自独立，直接读回表达式即可
    expect((w.emitted('update:modelValue')?.at(-1)?.[0] as string)).toBe('0/15')
  })

  it('excluded（日/周互斥）时整块锁死并强制输出 `?`', async () => {
    const w = mountField({ modelValue: '*', excluded: true })
    await flushPromises()
    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['?'])
    // 锁定态下全部控件 disabled
    expect(document.body.querySelectorAll('.el-radio.is-disabled').length).toBeGreaterThan(0)
  })
})

// cron 组装器（迁移旧 components/Cron/Cron.vue）
describe('CronBuilder · 秒分时日月周组装', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  it('传入表达式 → 六个字段与预览表格按位还原', async () => {
    wrapper = mount(CronBuilder, {
      attachTo: document.body,
      props: { modelValue: '0 0 6-22 * * ?' },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    const cells = [...document.body.querySelectorAll('.cb-preview td .cell')].map((el) => el.textContent?.trim())
    expect(cells).toEqual(['0', '0', '6-22', '*', '*', '?', '0 0 6-22 * * ?'])
  })

  it('传空串不覆盖默认值 → 回吐 `0 0 * * * ?`（旧 formatValue 的空值分支）', async () => {
    wrapper = mount(CronBuilder, {
      attachTo: document.body,
      props: { modelValue: '' },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['0 0 * * * ?'])
  })

  it('日与周互斥：给了周就把日压成 `?`，给了号就把周压成 `?`', async () => {
    wrapper = mount(CronBuilder, {
      attachTo: document.body,
      props: { modelValue: '0 0 19 ? * 1' },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    let cells = [...document.body.querySelectorAll('.cb-preview td .cell')].map((el) => el.textContent?.trim())
    expect(cells.slice(3)).toEqual(['?', '*', '1', '0 0 19 ? * 1'])

    await wrapper.setProps({ modelValue: '0 0 3 15 * ?' })
    await flushPromises()
    cells = [...document.body.querySelectorAll('.cb-preview td .cell')].map((el) => el.textContent?.trim())
    expect(cells.slice(3)).toEqual(['15', '*', '?', '0 0 3 15 * ?'])
  })
})
