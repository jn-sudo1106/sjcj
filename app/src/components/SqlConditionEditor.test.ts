// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElDialog } from 'element-plus'
import SqlConditionEditor from './SqlConditionEditor.vue'
import DataQueryPanel from './DataQueryPanel.vue'
import { dataApi } from '@/api'
import { readSqlConditions, rememberSqlCondition } from '@/utils/sqlConditionHistory'

const mounted: { unmount: () => void }[] = []
function setup() {
  const wrapper = mount(defineComponent({
    components: { SqlConditionEditor },
    setup: () => ({ sql: ref('K1 IS NULL'), tableId: ref('900') }),
    template: '<SqlConditionEditor v-model="sql" v-slot="{ value, update }" :table-id="tableId" table-name="TB_CNEWS"><input :value="value" @input="update($event.target.value)" aria-label="查询条件" /></SqlConditionEditor>',
  }), { attachTo: document.body, global: { plugins: [ElementPlus], stubs: { transition: false } } })
  mounted.push(wrapper)
  return wrapper
}
function textarea() {
  return document.querySelector<HTMLTextAreaElement>('[aria-label="SQL 条件编辑区"]')!
}
async function edit(value: string) {
  textarea().value = value
  textarea().dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}
async function clickDialogButton(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) => item.textContent?.trim() === text)!
  button.click()
  await flushPromises()
}
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('SQL 条件放大编辑', () => {
  it('首次使用显示空态；重新打开能读到其他入口保存的历史，选择只填草稿，清空仅影响当前表', async () => {
    const wrapper = setup()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await clickDialogButton('最近条件')
    expect(document.body.textContent).toContain('暂无最近条件，成功查询后自动记录')
    await clickDialogButton('取消')
    const sql = "K1 LIKE '%金融%'\nAND K5 IS NOT NULL"
    rememberSqlCondition('900', sql)
    rememberSqlCondition('901', 'K2 IS NULL')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await clickDialogButton('最近条件')
    const item = document.querySelector<HTMLElement>('.sql-recent-condition')!
    expect(item.textContent).toBe(sql)
    item.click()
    await flushPromises()
    expect(textarea().value).toBe(sql)
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await clickDialogButton('最近条件')
    const clear = [...document.querySelectorAll<HTMLElement>('.el-dropdown-menu__item')]
      .find((el) => el.textContent?.includes('清空当前表'))!
    clear.click()
    await flushPromises()
    expect(readSqlConditions('900')).toEqual([])
    expect(readSqlConditions('901')).toEqual(['K2 IS NULL'])
    expect(textarea().value).toBe(sql)
    await clickDialogButton('应用条件')
    expect(wrapper.vm.sql).toBe(sql)
    expect(readSqlConditions('900')).toEqual([])
  })

  it('打开带原条件和表信息，编辑草稿不改原框；应用原样保留换行和引号', async () => {
    const wrapper = setup()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(textarea().value).toBe('K1 IS NULL')
    expect(document.body.textContent).toContain('TB_CNEWS（900）')
    const sql = "K1 LIKE '%金融%'\nAND (K2 IS NULL OR K5 = '证券时报')"
    await edit(sql)
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await clickDialogButton('应用条件')
    expect(wrapper.vm.sql).toBe(sql)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe(sql.replace(/\n/g, ' '))
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(textarea().value).toBe(sql)
  })

  it.each(['取消', 'Escape', '关闭此对话框'])('%s 丢弃修改，再打开恢复原值', async (action) => {
    const wrapper = setup()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await edit('K2 IS NULL')
    if (action === 'Escape') {
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    } else if (action === '取消') {
      await clickDialogButton(action)
    } else {
      document.querySelector<HTMLButtonElement>('.el-dialog__headerbtn')!.click()
    }
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false))
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(textarea().value).toBe('K1 IS NULL')
  })

  it('切表关闭旧草稿，允许主动应用空条件', async () => {
    const wrapper = setup()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await edit('K2 IS NULL')
    wrapper.vm.tableId = '901'
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false))
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await edit('')
    await clickDialogButton('应用条件')
    expect(wrapper.vm.sql).toBe('')
  })

  it('真实查询面板：编辑、回车、应用均不请求，点击查询才提交完整 SQL', async () => {
    const query = vi.spyOn(dataApi, 'rowQueryPaged').mockResolvedValue({ list: [], total: 0 })
    const wrapper = mount(DataQueryPanel, {
      attachTo: document.body,
      props: { tableId: '900', columns: [] },
      global: { plugins: [ElementPlus], stubs: { transition: false } },
    })
    mounted.push(wrapper)
    await wrapper.get('.dqp-advanced-toggle').trigger('click')
    await wrapper.get('[aria-label="放大编辑 SQL 条件"]').trigger('click')
    await flushPromises()
    const sql = "K1 LIKE '%金融%'\nAND K5 IS NOT NULL"
    await edit(sql)
    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await clickDialogButton('应用条件')
    expect(query).not.toHaveBeenCalled()
    expect(readSqlConditions('900')).toEqual([])
    await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ tableId: '900', sql }))
    expect(readSqlConditions('900')).toEqual([sql])
  })
})
