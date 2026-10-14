// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import EntryEditorDrawer from './EntryEditorDrawer.vue'
import { entryApi, type EntryType } from '../../api'

// el-drawer append-to-body：内容 teleport 到 document.body，需用 DOMWrapper 查找（同 ParamTab.test.ts 套路）
function body() {
  return new DOMWrapper(document.body)
}

// 表 ID 列表迁移方案 §1.4/§4.5：K 序只读自动编号、去重↔keyField 联动、重复编码校验
describe('EntryEditorDrawer · 数据表编辑器', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  async function mountEditor(entry: EntryType | null) {
    wrapper = mount(EntryEditorDrawer, {
      props: { modelValue: true, entry },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    return wrapper
  }

  it('新建：新增行 columnName 自动编号 K1，已有字段的 columnName 输入框只读', async () => {
    await mountEditor(null)
    const columnInputs = body().findAll('td input[disabled]')
    expect(columnInputs.length).toBeGreaterThan(0)
    expect((columnInputs[0].element as HTMLInputElement).value).toBe('K1')
  })

  it('新增字段：新行编号在既有最大序号基础上 +1，不改写已有行 columnName', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K3', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    await body().findAll('button').find((b) => b.text() === '＋ 新增字段')!.trigger('click')
    await flushPromises()

    const columnInputs = body().findAll('td input[disabled]').map((i) => (i.element as HTMLInputElement).value)
    expect(columnInputs).toEqual(['K1', 'K3', 'K4'])
  })

  // 2026-08-28 生产实测 77 张表，K 序全部连续、零空洞——columnName 是前端定的、后端照单收，
  // 删掉中间的新增行必须把后面的新增行补上来，不能给后端漏空洞。
  // 前提是「只有新增行可删」：已落库字段（itemId>0）的 columnName 一个都不碰。
  it('删掉中间的新增行后，后续新增行的 K 序补齐，不留空洞', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K2', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    const addBtn = () => body().findAll('button').find((b) => b.text() === '＋ 新增字段')!
    await addBtn().trigger('click')
    await addBtn().trigger('click')
    await addBtn().trigger('click')
    await flushPromises()
    const cols = () => body().findAll('td input[disabled]').map((i) => (i.element as HTMLInputElement).value)
    expect(cols()).toEqual(['K1', 'K2', 'K3', 'K4', 'K5'])

    // 删掉中间那个新增行（K4）。已落库行也有删除按钮（禁用态），所以只在可用的里面取。
    const enabledDels = () => body().findAll('button.danger').filter((b) => b.attributes('aria-disabled') !== 'true')
    await enabledDels()[1].trigger('click')
    await flushPromises()
    expect(cols()).toEqual(['K1', 'K2', 'K3', 'K4'])
  })

  it('补齐 K 序时绝不改写已落库字段的 columnName', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K5', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    await body().findAll('button').find((b) => b.text() === '＋ 新增字段')!.trigger('click')
    await flushPromises()
    await body().findAll('button.danger').filter((b) => b.attributes('aria-disabled') !== 'true')[0].trigger('click')
    await flushPromises()
    // 已落库的 K1 / K5 原样保留（K5 那个"空洞"是历史数据，不该被我们悄悄压缩）
    const cols = body().findAll('td input[disabled]').map((i) => (i.element as HTMLInputElement).value)
    expect(cols).toEqual(['K1', 'K5'])
  })

  // 2026-08-28：已落库行改成**禁用态**删除按钮（原来是直接不渲染）——
  // 整列空白看不出"为什么这行不能删"，禁用 + 悬浮说明才讲得清。
  // 2026-10：禁用态用 aria-disabled + 置灰（原来纯 disabled 不触发点击，点红按钮毫无反应、没有提示）。
  it('已有行（itemId>0）的删除按钮 aria-disabled 置灰且点击有提示，新增行可删', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
      ],
    }
    await mountEditor(entry)
    expect(body().findAll('button.danger').length).toBe(1)
    expect(body().find('button.danger').attributes('aria-disabled')).toBe('true')

    // 点击已落库行的删除：不删行，弹提示
    const warnSpy = vi.spyOn(ElMessage, 'warning')
    await body().find('button.danger').trigger('click')
    await flushPromises()
    expect(warnSpy).toHaveBeenCalledWith('该字段已落库，物理列绑着数据，不能删除')
    expect(body().findAll('tbody tr').length).toBe(1)

    await body().findAll('button').find((b) => b.text() === '＋ 新增字段')!.trigger('click')
    await flushPromises()
    const dels = body().findAll('button.danger')
    expect(dels.length).toBe(2)
    expect(dels[0].attributes('aria-disabled')).toBe('true')   // 已落库
    expect(dels[1].attributes('aria-disabled')).toBe('false') // 新增行
  })

  // 2026-10：空编码且空展示名的**已落库**行是脏数据（此前缺校验被存进表定义），
  // 允许清理：二次确认后从表定义移除（保存时 items 不再含它），不弹"不能删除"。
  it('空编码+空展示名的已落库行：二次确认后可删除（脏数据清理）', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: 'code', desc: '编码', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: '', desc: '', type: 'string', required: false, dedup: false, columnName: 'K4', itemId: '9', seq: 2 },
      ],
    }
    await mountEditor(entry)
    const dels = () => body().findAll('button.danger')
    expect(dels().length).toBe(2)
    // 空字段行不置灰（可删），正常字段行置灰
    expect(dels()[0].attributes('aria-disabled')).toBe('true')
    expect(dels()[1].attributes('aria-disabled')).toBe('false')

    // 点空字段行的删除：弹确认框，确认后移除
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    await dels()[1].trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalled()
    expect(body().findAll('tbody tr').length).toBe(1) // 确认后行被移除
    expect(body().find('tbody tr td:nth-child(2) input').element as HTMLInputElement).toBeTruthy()
  })

  it('空编码+空展示名的已落库行：取消确认则不移除', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', fields: [
        { prop: '', desc: '', type: 'string', required: false, dedup: false, columnName: 'K4', itemId: '9', seq: 1 },
      ],
    }
    await mountEditor(entry)
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel' as never)
    await body().find('button.danger').trigger('click')
    await flushPromises()
    expect(body().findAll('tbody tr').length).toBe(1) // 取消后仍在
  })

  it('去重勾选联动：勾选字段后只读 keyField 输入按 columnName 逗号连接实时更新', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', keyField: '', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'b', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K2', itemId: '2', seq: 2 },
      ],
    }
    await mountEditor(entry)
    // 去重是每行第一个 checkbox（第二个是必填），按行取避免被列数变化影响
    const rows = body().findAll('tbody tr')
    await rows[0].find('td input[type="checkbox"]').setValue(true)
    await rows[1].find('td input[type="checkbox"]').setValue(true)
    await flushPromises()

    const keyFieldField = body().findAll('.rc-field').find((f) => f.text().includes('去重列'))!
    const keyFieldInput = keyFieldField.find('input')
    expect((keyFieldInput.element as HTMLInputElement).value).toBe('K1,K2')
  })

  it('必填勾选：勾了才会作为 true 传给 entrySave（数据表页动态列按 required 过滤，需要能勾）', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', name: '表A', fields: [
        { prop: 'a', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
      ],
    }
    const saveSpy = vi.spyOn(entryApi, 'entrySave').mockResolvedValue({ message: 'ok', tableId: 't1' })
    await mountEditor(entry)
    // 每行第二个 checkbox 是必填（第一个是去重）
    await body().findAll('tbody tr')[0].findAll('td input[type="checkbox"]')[1].setValue(true)
    await body().findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(saveSpy).toHaveBeenCalledWith(expect.objectContaining({
      fields: [expect.objectContaining({ prop: 'a', required: true })],
    }))
  })

  it('提交前校验：itemCode 重复时报错且不调用 entrySave', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', name: '表A', fields: [
        { prop: 'dup', desc: 'A', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: 'dup', desc: 'B', type: 'string', required: false, dedup: false, columnName: 'K2', itemId: '2', seq: 2 },
      ],
    }
    const saveSpy = vi.spyOn(entryApi, 'entrySave')
    const warnSpy = vi.spyOn(ElMessage, 'warning')
    await mountEditor(entry)

    await body().findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(warnSpy).toHaveBeenCalledWith('出错，属性重复:dup')
    expect(saveSpy).not.toHaveBeenCalled()
  })

  // 2026-10：编码 / 展示名逐字段非空校验（对齐旧 EntryTypeEdit 的 requireRule）。
  // 此前漏了这条，空编码字段会被存进库、落库后删不掉。
  it('提交前校验：编码或展示名为空的字段拦截，不调用 entrySave', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', name: '表A', fields: [
        { prop: 'code', desc: '编码', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: '', desc: '', type: 'string', required: false, dedup: false, columnName: 'K4', seq: 2 },
      ],
    }
    const saveSpy = vi.spyOn(entryApi, 'entrySave')
    const warnSpy = vi.spyOn(ElMessage, 'warning')
    await mountEditor(entry)

    await body().findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    expect(warnSpy).toHaveBeenCalledWith('出错，属性不能为空')
    expect(saveSpy).not.toHaveBeenCalled()
  })

  // 1013：编码/展示名列头必填星号 + 提交拦截时空行输入框标红、输入即清（用户反馈「新增字段没校验、缺必填标识」）
  it('字段表编码/展示名列头带必填星号', async () => {
    await mountEditor(null)
    const headRow = body().find('.ete-table thead tr')
    const requiredStars = headRow.findAll('span.ete-required')
    // 编码 + 展示名两列各一个必填红星
    expect(requiredStars.length).toBe(2)
    expect(requiredStars.every((s) => s.text() === '*')).toBe(true)
    // 星号紧跟在「编码」「展示名」之后
    expect(headRow.html()).toContain('编码<span')
    expect(headRow.html()).toContain('展示名<span')
  })

  it('提交拦截时：空的编码/展示名输入框标红（is-invalid），并标 aria-invalid', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', name: '表A', fields: [
        { prop: 'code', desc: '编码', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: '', desc: '', type: 'string', required: false, dedup: false, columnName: 'K4', seq: 2 },
      ],
    }
    vi.spyOn(entryApi, 'entrySave')
    vi.spyOn(ElMessage, 'warning')
    await mountEditor(entry)

    await body().findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    // 第二行（空编码/空展示名）的两个输入框都标红；第一行（有值）不标红
    const rows = body().findAll('.ete-table tbody tr')
    const row2Inputs = rows[1].findAll('input.rc-input')
    expect(row2Inputs[0].classes()).toContain('is-invalid')
    expect(row2Inputs[0].attributes('aria-invalid')).toBe('true')
    expect(row2Inputs[1].classes()).toContain('is-invalid')
    expect(row2Inputs[1].attributes('aria-invalid')).toBe('true')
    const row1Inputs = rows[0].findAll('input.rc-input')
    expect(row1Inputs[0].classes()).not.toContain('is-invalid')
  })

  it('空行输入内容后，该输入框标红即时清除（可正常继续编辑）', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', name: '表A', fields: [
        { prop: 'code', desc: '编码', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
        { prop: '', desc: '', type: 'string', required: false, dedup: false, columnName: 'K4', seq: 2 },
      ],
    }
    vi.spyOn(entryApi, 'entrySave')
    vi.spyOn(ElMessage, 'warning')
    await mountEditor(entry)

    await body().findAll('button').find((b) => b.text() === '保存')!.trigger('click')
    await flushPromises()

    const rows = body().findAll('.ete-table tbody tr')
    const codeInput = rows[1].findAll('input.rc-input')[0]
    expect(codeInput.classes()).toContain('is-invalid')

    // 输入编码 → 该框标红清除，另一个（展示名）仍标红
    await codeInput.setValue('new_code')
    await flushPromises()
    expect(codeInput.classes()).not.toContain('is-invalid')
    expect(rows[1].findAll('input.rc-input')[1].classes()).toContain('is-invalid')
  })

  it('拖左边缘拉宽：resize-end 写入本地偏好，重开抽屉沿用拉宽后的宽度', async () => {
    localStorage.removeItem('rc.dataview.entryEditor.drawerWidth')
    await mountEditor(null)
    const drawer = wrapper.findComponent({ name: 'ElDrawer' })
    expect(drawer.exists()).toBe(true)
    // 默认 760px
    expect(drawer.props('size')).toBe('760px')

    // 模拟官方 useResizable 松手：resize-end(evt, 最终宽度)
    drawer.vm.$emit('resize-end', {} as MouseEvent, 980)
    await flushPromises()
    expect(localStorage.getItem('rc.dataview.entryEditor.drawerWidth')).toBe('980')

    // 重开（换个实例）应从偏好读回 980
    wrapper.unmount()
    await mountEditor(null)
    const drawer2 = wrapper.findComponent({ name: 'ElDrawer' })
    expect(drawer2.props('size')).toBe('980px')
  })

  // 1013：编辑已有表时物理表名不允许修改（后端 modifyEntryType 会把 tableName 原样选择性更新，
  // 改错会让表配置指向不存在的物理表）；新建时可编辑/自动生成。
  it('编辑态：物理表名输入框 disabled，且带原因提示', async () => {
    const entry: EntryType = {
      tableId: 't1', tableName: 'tb_a', name: '表A', fields: [
        { prop: 'code', desc: '编码', type: 'string', required: false, dedup: false, columnName: 'K1', itemId: '1', seq: 1 },
      ],
    }
    await mountEditor(entry)
    const input = body().find('input[data-testid="entry-table-name"]')
    expect((input.element as HTMLInputElement).disabled).toBe(true)
    expect(input.attributes('title')).toContain('不允许修改')
  })

  it('新建态：物理表名输入框可编辑', async () => {
    await mountEditor(null)
    const input = body().find('input[data-testid="entry-table-name"]')
    expect((input.element as HTMLInputElement).disabled).toBe(false)
    await input.setValue('TB_NEW')
    expect((input.element as HTMLInputElement).value).toBe('TB_NEW')
  })
})
