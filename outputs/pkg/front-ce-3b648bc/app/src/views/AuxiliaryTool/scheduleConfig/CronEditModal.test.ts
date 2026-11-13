// @vitest-environment jsdom
// 表达式修改弹窗：pick 模式回传、可视化编辑器的「挂载回填要吞掉」、@秒数 / 7 段不支持可视化编辑。
// 这三条是旧版最容易回归的行为（编辑器一挂载就会 emit 一次默认值，不吞掉会把用户的表达式改坏）。
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ElementPlus from 'element-plus'
import CronEditModal from './CronEditModal.vue'
import CronEditor from './CronEditor.vue'

function mountModal() {
  return mount(CronEditModal, { attachTo: document.body, global: { plugins: [ElementPlus] } })
}

function footerButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('.el-dialog__footer button')) as HTMLButtonElement[]
}

describe('CronEditModal', () => {
  it('pick 模式：编辑器改动后点「使用该表达式」回传新 cron', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { show: (o: unknown) => void }).show({ mode: 'pick', cron: '0 0 3 * * ?' })
    await flushPromises()

    const editor = wrapper.findComponent(CronEditor)
    expect(editor.exists()).toBe(true)
    // 编辑器挂载时会 emit 一次，那次必须被 editorReady 吞掉（否则 newCron 会被默认值覆盖）
    editor.vm.$emit('change', '0 0 5 * * ?')
    await nextTick()

    const okButton = footerButtons().find((btn) => btn.textContent?.includes('使用该表达式'))
    expect(okButton).toBeTruthy()
    okButton!.click()
    await flushPromises()

    const picked = wrapper.emitted('pick')
    expect(picked).toBeTruthy()
    expect(picked![0]).toEqual(['0 0 5 * * ?'])
  })

  it('@秒数 格式不渲染可视化编辑器，并给出说明', async () => {
    const wrapper = mountModal()
    ;(wrapper.vm as unknown as { show: (o: unknown) => void }).show({ mode: 'pick', cron: '@300' })
    await flushPromises()
    expect(wrapper.findComponent(CronEditor).exists()).toBe(false)
    expect(document.body.textContent).toContain('不支持可视化编辑')
  })

  it('batch 模式：原表达式相同则不发请求（提示后直接返回）', async () => {
    let called = 0
    const wrapper = mount(CronEditModal, {
      attachTo: document.body,
      props: {
        callback: async () => {
          called += 1
          return {}
        },
      },
      global: { plugins: [ElementPlus] },
    })
    ;(wrapper.vm as unknown as { show: (o: unknown) => void }).show({
      mode: 'batch',
      oldCron: '0 0 3 * * ?',
      jobCnt: 3,
    })
    await flushPromises()

    // 批量模式默认把原表达式预填进输入框，直接提交 = 没有改动
    const submit = footerButtons().find((btn) => btn.textContent?.includes('提交'))
    expect(submit).toBeTruthy()
    submit!.click()
    await flushPromises()
    expect(called).toBe(0)
  })
})
