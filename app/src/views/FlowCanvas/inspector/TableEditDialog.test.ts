// @vitest-environment jsdom
// 画布侧表编辑弹窗的三条迁移欠账（0828 表编辑核对 §3.1/§3.2/§3.3）：
//   ① 只有新增行可删（旧 EntryTypeEdit 的删除图标带 itemId<=0 条件）；
//   ② 去重勾选要产出 keyField（此前勾了没用，而表配置的「去重列」读的正是它）；
//   ③ 删除后新增行 K 序补齐、已落库列不动。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import TableEditDialog from './TableEditDialog.vue'
import { entryApi, type EntryType } from '@/api'

const TABLE: EntryType = {
  tableId: '2103330', tableName: 'sense_data.TB_NEWS', name: '资讯列表', fields: [
    { prop: 'title-K1', desc: '标题', type: 'string', required: false, columnName: 'K1', itemId: '11', dedup: true },
    { prop: 'url-K2', desc: '链接', type: 'string', required: false, columnName: 'K2', itemId: '12' },
  ],
}

// 保存失败要弹 ElMessage.error（2026-09-22）：真实实现会往 body 插 DOM，
// 这里只关心"有没有喊出来"，所以把两个用到的方法换成 spy
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }
})

afterEach(() => vi.restoreAllMocks())

async function mountDialog() {
  vi.spyOn(entryApi, 'entryDetail').mockResolvedValue(TABLE)
  const wrapper = mount(TableEditDialog, {
    props: { open: true, tableId: '2103330' },
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  return wrapper
}
type W = Awaited<ReturnType<typeof mountDialog>>
const cols = (w: W) => w.findAll('td.mono').map((e) => e.text())
const dels = (w: W) => w.findAll('[data-testid="ted-del"]')
const clickAdd = async (w: W) => {
  await w.findAll('button').find((b) => b.text().includes('新增字段'))!.trigger('click')
}
const clickOk = async (w: W) => {
  await w.findAll('button').find((b) => b.text() === '确定')!.trigger('click')
  await flushPromises()
}

describe('TableEditDialog · 迁移欠账补齐', () => {
  it('已落库字段没有删除按钮，只有新增行有', async () => {
    const w = await mountDialog()
    expect(dels(w).length).toBe(0)
    await clickAdd(w)
    expect(dels(w).length).toBe(1)
  })

  it('删掉中间的新增行后 K 序补齐，已落库列原样不动', async () => {
    const w = await mountDialog()
    await clickAdd(w); await clickAdd(w); await clickAdd(w)
    expect(cols(w)).toEqual(['K1', 'K2', 'K3', 'K4', 'K5'])

    await dels(w)[1].trigger('click')
    expect(cols(w)).toEqual(['K1', 'K2', 'K3', 'K4'])
  })

  it('顶部「去重列」只读展示，随字段表的去重勾选实时变化', async () => {
    const w = await mountDialog()
    const keyFieldOf = () => (w.get('[data-testid="ted-key-field"]').element as HTMLInputElement).value
    expect(keyFieldOf()).toBe('K1') // TABLE 里只有 K1 勾了去重

    // 勾上 K2 → 去重列跟着变
    const dedupBoxes = w.findAll('input.ted-check')
    await dedupBoxes[1].setValue(true)
    expect(keyFieldOf()).toBe('K1,K2')

    // 全取消 → 显示占位
    await dedupBoxes[0].setValue(false)
    await dedupBoxes[1].setValue(false)
    expect(keyFieldOf()).toBe('—')
  })

  it('去重列是只读的：要改得去字段表勾选', async () => {
    const w = await mountDialog()
    expect(w.get('[data-testid="ted-key-field"]').attributes('readonly')).toBeDefined()
  })

  // 新建态才自动生成物理表名（旧 EntryTypeEdit 的 watch typeName），
  // 且用户手改过就不再覆盖——这条比旧平台严，旧平台是无条件覆盖。
  it('新建表：名称按拼音首字母生成物理表名', async () => {
    const w = mount(TableEditDialog, { props: { open: true }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    const nameInput = w.findAll('input.ted-input')[0]
    await nameInput.setValue('资讯列表')
    expect((w.findAll('input.ted-input')[1].element as HTMLInputElement).value).toBe('TB_ZXLB')
  })

  it('新建表：用户手改过物理表名后，再改名称不覆盖他填的', async () => {
    const w = mount(TableEditDialog, { props: { open: true }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    const inputs = () => w.findAll('input.ted-input')
    await inputs()[1].setValue('sense_data.MY_TABLE')
    await inputs()[0].setValue('资讯列表')
    expect((inputs()[1].element as HTMLInputElement).value).toBe('sense_data.MY_TABLE')
  })

  it('编辑已有表时不自动改物理表名', async () => {
    const w = await mountDialog()
    await w.findAll('input.ted-input')[0].setValue('改个名字')
    expect((w.findAll('input.ted-input')[1].element as HTMLInputElement).value).toBe('sense_data.TB_NEWS')
  })

  it('预处理用带预设的 autocomplete，预设与采集资产侧同一份', async () => {
    const w = await mountDialog()
    expect(w.findAllComponents({ name: 'ElAutocomplete' }).length).toBe(TABLE.fields.length)
  })

  it('保存时把勾了「去重」的字段聚合成 keyField', async () => {
    const save = vi.spyOn(entryApi, 'entrySave').mockResolvedValue({ tableId: '2103330', message: 'ok' })
    const w = await mountDialog()
    await clickOk(w)
    expect(save).toHaveBeenCalled()
    expect(save.mock.calls[0][0].keyField).toBe('K1')
  })

  it('保存时回传 itemId / columnName，后端才认得出是改哪一行', async () => {
    const save = vi.spyOn(entryApi, 'entrySave').mockResolvedValue({ tableId: '2103330', message: 'ok' })
    const w = await mountDialog()
    await clickOk(w)
    expect(save.mock.calls[0][0].fields.map((f) => [f.itemId, f.columnName])).toEqual([['11', 'K1'], ['12', 'K2']])
  })

  // 2026-09-22 用户在生产报「新建表点确定没反应」。原因：entrySave 在生产必然抛
  // （config/entryTypeAddAll 标了 danger 但不在生产写白名单，守卫在发请求前就拦下），
  // 而这里是裸 await，抛错变成未捕获 rejection、界面毫无反应。
  it('保存失败时给出错误提示，且**不关弹窗**（字段表填了十几行，关掉就全丢）', async () => {
    const msg = '生产环境写保护：端点 [config/entryTypeAddAll] 不在允许清单，已阻止发送，未联网'
    vi.spyOn(entryApi, 'entrySave').mockRejectedValue(new Error(msg))
    const w = await mountDialog()
    await clickOk(w)
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith(msg)
    // 没有 emit 关闭，也没有 emit saved
    expect(w.emitted('update:open')).toBeUndefined()
    expect(w.emitted('saved')).toBeUndefined()
  })

  it('保存中按钮禁用并改文案，避免连点把同一张表建两次', async () => {
    let release: (v: { tableId: string }) => void = () => {}
    vi.spyOn(entryApi, 'entrySave').mockReturnValue(new Promise((r) => { release = r }) as never)
    const w = await mountDialog()
    const ok = w.findAll('button').find((b) => b.text() === '确定')!
    await ok.trigger('click')
    await flushPromises()

    const busy = w.findAll('button').find((b) => b.text() === '保存中…')
    expect(busy).toBeTruthy()
    expect(busy!.attributes('disabled')).toBeDefined()

    release({ tableId: '2103330' })
    await flushPromises()
  })
})
