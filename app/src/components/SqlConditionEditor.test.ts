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
/** 编辑区同样要等：弹窗内容由 ElDialog 异步渲染，点完下拉项后还会重渲一次。 */
async function textarea() {
  return vi.waitFor(() => {
    const el = document.querySelector<HTMLTextAreaElement>('[aria-label="SQL 条件编辑区"]')
    if (!el) throw new Error('SQL 编辑区还没挂上')
    return el
  }, WAIT)
}
async function edit(value: string) {
  const el = await textarea()
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}
/**
 * ⚠️ 这些助手**必须等元素出现**，不能查完就用。
 *
 * Element Plus 的弹窗/下拉走 teleport + 过渡，挂载不是同步的；`flushPromises()` 只刷微任务，
 * 单跑这个文件够快所以看不出问题，**全量跑时会间歇失败**（2026-09-05 实测两种表现：
 * `button.click()` 报 undefined、`textarea().value` 报 null）。用 vi.waitFor 兜住。
 *
 * 光加 waitFor 还不够，**超时也得放宽**：vi.waitFor 默认只等 1000ms，全量跑时多个 worker
 * 抢 CPU，teleport + 过渡挂完常常超过这个数，于是 waitFor 自己超时，报成"下拉还没挂上"
 * ——看着像组件坏了，其实只是没等够（2026-09-10 实测复现：全量跑必现于 recentConditionItem，
 * 同一条用例单跑 6 次全过）。放宽超时不会拖慢单跑：元素挂上就立刻返回，等不到才是真失败。
 *
 * **必须给用例超时留出余量**：waitFor 等满而用例先超时的话，报的是
 * "Test timed out in 5000ms"，把"哪个元素没挂上"这个真正有用的信息盖掉。
 * 一度只敢给到 3s（当时用例超时还是默认的 5s），机器有负载时仍然不够；
 * 2026-09-11 把全局 testTimeout 抬到 15s 之后，这里同步放宽到 8s。
 *
 * 同日补齐：文件里剩下的裸 `querySelector(...)!`（textarea / .el-dialog__headerbtn /
 * .el-dropdown-menu__item / .sql-recent-condition-compact）也一并改成等元素出现。
 * 超时压住之后，真正炸出来的正是它们——`textarea()` 返回 null，报
 * `Cannot read properties of null`，与本注释开头 0905 记录的表现一模一样。
 */
const WAIT = { timeout: 8000, interval: 20 }
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
  }, WAIT)
}
async function clickDialogButton(text: string) {
  const button = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find((item) => item.textContent?.trim() === text)
    if (!found) throw new Error(`弹窗里没找到按钮：${text}`)
    return found
  }, WAIT)
  button.click()
  await flushPromises()
}
/**
 * 关闭弹窗。0904 I05 之后**没有「取消」按钮**了（「点一下外面就取消掉了，一般都没有取消」），
 * 所以统一走右上角关闭；点遮罩在 jsdom 里不便模拟。
 */
async function closeDialog() {
  const btn = await vi.waitFor(() => {
    const el = document.querySelector<HTMLButtonElement>('.el-dialog__headerbtn')
    if (!el) throw new Error('弹窗关闭按钮还没挂上')
    return el
  }, WAIT)
  btn.click()
  await flushPromises()
  await vi.waitFor(() => {
    if (document.querySelector('.sql-editor')) throw new Error('弹窗还没关完')
  }, WAIT)
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
  }, WAIT)
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
    expect((await textarea()).value).toBe(sql)
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await clickDialogButton('最近条件')
    const clear = await vi.waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.el-dropdown-menu__item')]
        .find((item) => item.textContent?.includes('清空当前表'))
      if (!el) throw new Error('「清空当前表」菜单项还没挂上')
      return el
    }, WAIT)
    clear.click()
    await flushPromises()
    expect(readSqlConditions('900')).toEqual([])
    expect(readSqlConditions('901')).toEqual(['K2 IS NULL'])
    expect((await textarea()).value).toBe(sql)
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
    expect((await textarea()).value).toBe('K1 IS NULL')
    expect(document.body.textContent).toContain('TB_CNEWS（900）')
    const sql = "K1 LIKE '%金融%'\nAND (K2 IS NULL OR K5 = '证券时报')"
    await edit(sql)
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await clickDialogButton('确认')
    expect(wrapper.vm.sql).toBe(sql)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe(sql.replace(/\n/g, ' '))
    await openDialog(wrapper)
    expect((await textarea()).value).toBe(sql)
  })

  // 0904 I05：「取消」按钮已删除——「点一下外面就取消掉了，一般都没有取消」。
  // 丢弃修改的路径只剩 Escape 与右上角关闭（以及点遮罩，jsdom 里不便模拟）。
  it.each(['Escape', '关闭此对话框'])('%s 丢弃修改，再打开恢复原值', async (action) => {
    const wrapper = setup()
    await openDialog(wrapper)
    await edit('K2 IS NULL')
    if (action === 'Escape') {
      ;(await textarea()).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    } else if (action === '__never__') {
      await clickDialogButton(action)
    } else {
      ;(await vi.waitFor(() => {
        const el = document.querySelector<HTMLButtonElement>('.el-dialog__headerbtn')
        if (!el) throw new Error('弹窗关闭按钮还没挂上')
        return el
      }, WAIT)).click()
    }
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false), WAIT)
    expect(wrapper.vm.sql).toBe('K1 IS NULL')
    await openDialog(wrapper)
    expect((await textarea()).value).toBe('K1 IS NULL')
  })

  it('切表关闭旧草稿，允许主动应用空条件', async () => {
    const wrapper = setup()
    await openDialog(wrapper)
    await edit('K2 IS NULL')
    wrapper.vm.tableId = '901'
    await flushPromises()
    await vi.waitFor(() => expect(wrapper.findComponent(ElDialog).props('modelValue')).toBe(false), WAIT)
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
    ;(await textarea()).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
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
    const item = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('.sql-recent-condition-compact')
      if (!el) throw new Error('紧凑行的最近条件还没挂上')
      return el
    }, WAIT)
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

describe('按字段查询与字段智能联想', () => {
  function setupWithFields(fields = [
    { prop: 'title', columnName: 'K1', desc: '标题' },
    { prop: 'url', columnName: 'K2', desc: '网址' },
    { prop: 'content_path', columnName: 'K6', desc: '正文路径' },
    { prop: 'content_md5', columnName: 'K23', desc: '正文MD5' },
    { prop: 'ENTRY_ID', columnName: 'ENTRY_ID', desc: '主键 ID' },
  ]) {
    const wrapper = mount(defineComponent({
      components: { SqlConditionEditor },
      setup: () => ({ sql: ref(''), tableId: ref('900'), fields: ref(fields) }),
      template: '<SqlConditionEditor v-model="sql" v-slot="{ value, update }" :table-id="tableId" :fields="fields" table-name="TB_CNEWS"><input :value="value" @input="update($event.target.value)" aria-label="查询条件" /></SqlConditionEditor>',
    }), { attachTo: document.body, global: { plugins: [ElementPlus], stubs: { transition: false } } })
    mounted.push(wrapper)
    return wrapper
  }

  it('传入 fields 时渲染「按字段查询」按钮，点击弹出字段列表并展示列名与说明', async () => {
    const wrapper = setupWithFields()
    const btn = wrapper.find('[aria-label="按字段查询"]')
    expect(btn.exists()).toBe(true)

    await btn.trigger('click')
    await flushPromises()

    await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>('.sql-field-row')
      if (!el) throw new Error('字段列表还没挂上')
      return el
    }, WAIT)

    expect(document.body.textContent).toContain('正文MD5')
    expect(document.body.textContent).toContain('K23')
  })

  it('点击字段行默认插入 = 条件，已有条件时自动以 AND 拼接', async () => {
    const wrapper = setupWithFields()
    await wrapper.find('[aria-label="按字段查询"]').trigger('click')
    await flushPromises()

    const k23Row = await vi.waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.sql-field-row')]
        .find((item) => item.textContent?.includes('K23'))
      if (!el) throw new Error('K23 字段行还没挂上')
      return el
    }, WAIT)

    k23Row.click()
    await flushPromises()

    expect(wrapper.vm.sql).toBe("K23 = ''")

    // 第二次点击插入 K1，自动拼上 AND
    await wrapper.find('[aria-label="按字段查询"]').trigger('click')
    await flushPromises()

    const k1Row = await vi.waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.sql-field-row')]
        .find((item) => item.textContent?.includes('K1'))
      if (!el) throw new Error('K1 字段行还没挂上')
      return el
    }, WAIT)

    k1Row.click()
    await flushPromises()

    expect(wrapper.vm.sql).toBe("K23 = '' AND K1 = ''")
  })

  it('点击操作符按钮（如 LIKE、非空）插入对应的条件片段', async () => {
    const wrapper = setupWithFields()
    await wrapper.find('[aria-label="按字段查询"]').trigger('click')
    await flushPromises()

    const likeBtn = await vi.waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.sql-field-row')]
        .find((item) => item.textContent?.includes('K6'))
        ?.querySelector<HTMLButtonElement>('button[title*="LIKE"]')
      if (!el) throw new Error('K6 LIKE 按钮还没挂上')
      return el
    }, WAIT)

    likeBtn.click()
    await flushPromises()

    expect(wrapper.vm.sql).toBe("K6 LIKE '%%'")
  })

  it('放大弹窗中展示字段标签栏，点击字段插入编辑草稿', async () => {
    const wrapper = setupWithFields()
    await openDialog(wrapper)

    const tag = await vi.waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.sql-dialog-field-tag')]
        .find((item) => item.textContent?.includes('K23'))
      if (!el) throw new Error('K23 弹窗标签还没挂上')
      return el
    }, WAIT)

    tag.click()
    await flushPromises()

    expect((await textarea()).value).toBe("K23 = ''")

    await clickDialogButton('确认')
    expect(wrapper.vm.sql).toBe("K23 = ''")
  })
})

