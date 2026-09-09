// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
/**
 * ⚠️ 这些助手**必须等元素出现**，不能查完就用。
 *
 * Element Plus 的弹窗/下拉走 teleport + 过渡，挂载不是同步的；`flushPromises()` 只刷微任务，
 * 单跑这个文件够快所以看不出问题，**全量跑时会间歇失败**（2026-09-05 实测两种表现：
 * `button.click()` 报 undefined、`textarea().value` 报 null）。用 vi.waitFor 兜住。
 */
/**
 * 取弹窗「最近条件」下拉里的第一条历史。
 *
 * 必须 waitFor：ElDropdown 的菜单是异步 teleport 到 body 再由 popper 定位的，
 * `flushPromises()` 只刷微任务等不到它——单独跑这个文件时通常已经挂好了，全量跑
 * （CPU 吃紧）就会扑空拿到 null，表现为随机失败。
 */
async function recentConditionItem() {
  return vi.waitFor(() => {
    const el = document.querySelector<HTMLElement>('.sql-recent-condition')
    if (!el) throw new Error('最近条件下拉还没挂上')
    return el
  })
}
async function clickDialogButton(text: string) {
  const button = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((item) => item.textContent?.trim() === text)
    if (!found) throw new Error(`弹窗里没找到按钮：${text}`)
    return found
  })
  button.click()
  await flushPromises()
}
/**
 * 关闭弹窗。0904 I05 之后**没有「取消」按钮**了（「点一下外面就取消掉了，一般都没有取消」），
 * 所以统一走右上角关闭；点遮罩在 jsdom 里不便模拟。
 */
async function closeDialog() {
  document.querySelector<HTMLButtonElement>('.el-dialog__headerbtn')!.click()
  await flushPromises()
}
/**
 * 打开放大弹窗。**必须按 aria-label 定位**：紧凑行右端现在有两个图标按钮
 * （最近条件、放大编辑），`wrapper.get('button')` 会抓到第一个（最近条件），不是放大。
 */
async function openDialog(wrapper: ReturnType<typeof setup>) {
  await wrapper.get('[aria-label="放大编辑 SQL 条件"]').trigger('click')
  await flushPromises()
  await vi.waitFor(() => {
    if (!document.querySelector('.sql-editor')) throw new Error('放大弹窗还没挂上')
  })
}
// 进来先清一次（2026-09-09）：本文件与 utils/sqlConditionHistory.test.ts 用了同一批表键
// （900/901），同 worker 下共享 localStorage，只在 afterEach 清会依赖上一个文件收拾干净。
// 测试不该建立在别人清理到位的前提上。
beforeEach(() => localStorage.clear())
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('SQL 条件放大编辑', () => {
  it('首次使用显示空态；重新打开能读到其他入口保存的历史，选择只填草稿，清空仅影响当前表', async () => {
    const wrapper = setup()
    await openDialog(wrapper)
    await clickDialogButton('最近条件')
    expect(document.body.textContent).toContain('暂无最近条件，成功查询后自动记录')
    await closeDialog()
    const sql = "K1 LIKE '%金融%'\nAND K5 IS NOT NULL"
    rememberSqlCondition('900', sql)
    rememberSqlCondition('901', 'K2 IS NULL')
    await openDialog(wrapper)
    await clickDialogButton('最近条件')
    const item = await recentConditionItem()
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
    await clickDialogButton('确认')
    expect(wrapper.vm.sql).toBe(sql)
    expect(readSqlConditions('900')).toEqual([])
  })

  // 2026-09-09：整段从数据库客户端复制过来最常发生在放大弹窗里，那种语句多半带结尾分号，
  // 而查询框收的是拼进 WHERE 的片段，带分号后端直接报错。
  it('确认时削掉末尾分号；字符串字面量里的分号与换行原样保留', async () => {
    const wrapper = setup()
    await openDialog(wrapper)
    const sql = "K2 NOT LIKE '%weixin%'\nAND K1 LIKE '%a;b%';"
    await edit(sql)
    await clickDialogButton('确认')
    expect(wrapper.vm.sql).toBe("K2 NOT LIKE '%weixin%'\nAND K1 LIKE '%a;b%'")
  })

  it('打开带原条件和表信息，编辑草稿不改原框；应用原样保留换行和引号', async () => {
    const wrapper = setup()
    await openDialog(wrapper)
    expect(textarea().value).toBe('K1 IS NULL')
    expect(document.body.textContent).toContain('TB_CNEWS（900）')
    const sql = "K1 LIKE '%金融%'\nAND (K2 IS NULL OR K5 = '证券时报')"
    await edit(sql)
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await clickDialogButton('确认')
    expect(wrapper.vm.sql).toBe(sql)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe(sql.replace(/\n/g, ' '))
    await openDialog(wrapper)
    expect(textarea().value).toBe(sql)
  })

  // 0904 I05：「取消」按钮已删除——「点一下外面就取消掉了，一般都没有取消」。
  // 丢弃修改的路径只剩 Escape 与右上角关闭（以及点遮罩，jsdom 里不便模拟）。
  it.each(['Escape', '关闭此对话框'])('%s 丢弃修改，再打开恢复原值', async (action) => {
    const wrapper = setup()
    await openDialog(wrapper)
    await edit('K2 IS NULL')
    if (action === 'Escape') {
      textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    } else if (action === '__never__') {
      await clickDialogButton(action)
    } else {
      document.querySelector<HTMLButtonElement>('.el-dialog__headerbtn')!.click()
    }
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false))
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await openDialog(wrapper)
    expect(textarea().value).toBe('K1 IS NULL')
  })

  it('切表关闭旧草稿，允许主动应用空条件', async () => {
    const wrapper = setup()
    await openDialog(wrapper)
    await edit('K2 IS NULL')
    wrapper.vm.tableId = '901'
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false))
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await openDialog(wrapper)
    await edit('')
    await clickDialogButton('确认')
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
    await clickDialogButton('确认')
    expect(query).not.toHaveBeenCalled()
    expect(readSqlConditions('900')).toEqual([])
    await wrapper.findAll('button').find((button) => button.text() === '查询')!.trigger('click')
    await flushPromises()
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ tableId: '900', sql }))
    expect(readSqlConditions('900')).toEqual([sql])
  })
})

// 0904 I04：「放大是放大，最近条件是最近条件，这两个不一个东西」。
// 原来最近条件只藏在放大弹窗里，等于逼着用户先放大才能取历史，把两件事绑成一件。
describe('紧凑行的最近条件（Z4）', () => {
  it('不放大也能选最近条件，且**直接落到查询框**（弹窗里那份只落草稿）', async () => {
    rememberSqlCondition('900', "K7 = 'x'")
    const wrapper = setup()

    await wrapper.get('[aria-label="最近使用的 SQL 条件"]').trigger('click')
    await flushPromises()
    const item = document.querySelector<HTMLElement>('.sql-recent-condition-compact')!
    expect(item.textContent).toBe("K7 = 'x'")
    item.click()
    await flushPromises()

    expect(wrapper.vm.sql).toBe("K7 = 'x'")
    // 走的是紧凑行这条路，放大弹窗全程没打开过
    // （el-dialog 的根节点常驻 DOM，只能看 modelValue，不能靠 querySelector 判断）
    expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false)
  })

  it('没有历史时给空态，不是一个点了没反应的按钮', async () => {
    const wrapper = setup()
    await wrapper.get('[aria-label="最近使用的 SQL 条件"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('暂无最近条件，成功查询后自动记录')
  })
})

// 2026-09-09 生产实测的真实故障：多行 SQL 粘进紧凑框，HTML 规范把 <input> 里的换行
// 直接剥掉（不是换成空格），`2\nAND` 成了 `2AND`，后端报「传到的条件含有非法注入风险」。
describe('SqlConditionEditor · 粘贴多行 SQL', () => {
  function pasteInto(wrapper: ReturnType<typeof setup>, text: string, at = 0) {
    const input = wrapper.get('input').element as HTMLInputElement
    input.selectionStart = at
    input.selectionEnd = at
    const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => text } })
    input.dispatchEvent(e)
    return e
  }

  it('换行换成空格，不让它被浏览器剥成黏连的 `2AND`', async () => {
    const wrapper = setup()
    wrapper.vm.sql = ''
    await flushPromises()

    const e = pasteInto(wrapper, "k17 <> 2\nAND k2 NOT LIKE '%weixin%'")
    await flushPromises()

    expect(e.defaultPrevented).toBe(true)
    expect(wrapper.vm.sql).toBe("k17 <> 2 AND k2 NOT LIKE '%weixin%'")
    expect(wrapper.vm.sql).not.toContain('2AND')
  })

  it('单行粘贴不干预，交给浏览器默认行为（否则会和 v-model 打架）', async () => {
    const wrapper = setup()
    wrapper.vm.sql = ''
    await flushPromises()

    const e = pasteInto(wrapper, 'K1 IS NULL')
    await flushPromises()

    expect(e.defaultPrevented).toBe(false)
  })

  it('按光标位置插入，不覆盖已有内容', async () => {
    const wrapper = setup()
    wrapper.vm.sql = 'AB'
    await flushPromises()

    pasteInto(wrapper, 'x\ny', 1)
    await flushPromises()

    expect(wrapper.vm.sql).toBe('Ax yB')
  })
})
