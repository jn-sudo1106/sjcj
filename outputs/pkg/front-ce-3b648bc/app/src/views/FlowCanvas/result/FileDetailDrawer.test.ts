// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import FileDetailDrawer from './FileDetailDrawer.vue'
import { dataApi, sourceApi, type DataTableMeta, type FileResourceRecord } from '@/api'

vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('element-plus')>()
  return { ...actual, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }
})

const ElDrawerStub = {
  name: 'ElDrawer',
  props: ['modelValue', 'size', 'withHeader'],
  template: '<div class="drawer-stub" :data-size="size"><slot /></div>',
}
const TaskInstStub = {
  name: 'TaskInstDialog',
  props: ['modelValue', 'sourceId', 'taskId', 'canWrite'],
  template: '<div data-testid="task-inst-stub" />',
}

const fields: DataTableMeta['fields'] = [
  { prop: 'filename', type: 'string', desc: '文件名', columnName: 'K1', itemId: '52000365' },
  { prop: 'fileurl', type: 'url', desc: '文件链接', columnName: 'K2' },
  { prop: 'filepath', type: 'string', desc: '文件路径', columnName: 'K3' },
  { prop: 'filesize', type: 'number', desc: '文件大小', columnName: 'K4' },
]

function file(overrides: Partial<FileResourceRecord> = {}): FileResourceRecord {
  return {
    dataId: '7302555',
    sourceId: '430016824',
    state: 'C',
    createDt: '2026-08-21 18:01:58',
    updateDt: '2026-08-21 18:02:11',
    fileId: 'f-1',
    values: {
      K1: 'c37a9f1e.pdf',
      K2: 'https://files.example.com/a.pdf',
      K3: '/qinlong/anfa/a.pdf',
      K4: 1258291,
      QUERYID: 'q-1',
      IS_EXPORT: '0',
    },
    ...overrides,
  }
}

async function mountDrawer(props: Record<string, unknown> = {}) {
  const wrapper = mount(FileDetailDrawer, {
    props: {
      modelValue: true,
      file: file(),
      sourceName: '安发科技',
      tableId: '6200028',
      tableName: 'file_resource',
      fields,
      ...props,
    },
    global: {
      // 详情是 `<el-descriptions border>`（对齐旧 BaseDetail 的 bordered 键值表格），
      // 标签列要靠真实组件渲染 label（数据都在 `<td class="el-descriptions__label">` 里），
      // 所以这里注册真的 Element Plus，只把抽屉/任务弹窗换成轻量桩。
      plugins: [ElementPlus],
      stubs: { ElDrawer: ElDrawerStub, TaskInstDialog: TaskInstStub },
    },
  })
  await flushPromises()
  return wrapper
}

describe('FileDetailDrawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('抽屉宽度按旧 BaseDetail（min(850px, 92vw)），系统标识两列，源 ID / 类型 ID 是纯文本', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const wrapper = await mountDrawer()

    expect(wrapper.get('.drawer-stub').attributes('data-size')).toBe('min(850px, 92vw)')
    expect(wrapper.get('[data-testid="file-detail-sourceId"]').text()).toBe('430016824')
    expect(wrapper.get('[data-testid="file-detail-sourceId"]').element.tagName).toBe('SPAN')
    expect(wrapper.get('[data-testid="file-detail-tableId"]').text()).toBe('6200028')
    expect(wrapper.get('[data-testid="file-detail-tableId"]').element.tagName).toBe('SPAN')
    expect(wrapper.get('[data-testid="file-detail-sourceName"]').text()).toBe('安发科技')
    expect(wrapper.get('[data-testid="file-detail-tableName"]').text()).toBe('file_resource')
    expect(wrapper.text()).toContain('标识')
    expect(wrapper.text()).toContain('业务字段')
    // 详情是带框的键值表格：label 渲染在 `.el-descriptions__label` 单元格里
    // （旧 BaseDetail 的 `<a-descriptions border>` 形态），不是拼进值文本。
    // 清单顺序/文案逐项对齐旧平台 allColumns.ENTRY_DETAIL.base（含它把 updateDt/createDt
    // 的 title 写成原始字段名这处疏漏），共 16 项、每项 span 2（一行两项）。
    const labels = wrapper.findAll('[data-testid="file-detail-identity"] .el-descriptions__label').map((cell) => cell.text())
    expect(labels).toEqual([
      '数据ID', '源ID', '源名称', '文件ID', '类型ID', '类型名', '父ID', '任务ID',
      'updateDt', 'createDt', '版本', '总次数', '序号', '抓取日期', '原始', '子数据量',
    ])
  })

  it('业务字段按表结构渲染，QUERYID 进折叠的其他列', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const wrapper = await mountDrawer()

    const main = wrapper.get('[data-testid="file-detail-fields"]').text()
    // 旧平台 BaseDetail 的 label 是 `${字段名}-${物理列名}`，值后面的 code 是本项目加的溯源提示
    expect(main).toContain('文件名-K1')
    expect(main).toContain('filename · K1')
    expect(main).toContain('1.2 MB')
    expect(main).not.toContain('QUERYID')
    expect(wrapper.get('[data-testid="file-detail-extras"]').text()).toContain('QUERYID')
    expect(wrapper.get('[data-testid="file-detail-extras"]').text()).toContain('IS_EXPORT')
  })

  it('打开时请求 entryDetail，用返回行补标识、用 showItems 覆盖字段值', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: {
        ...file({ parentId: '88001', categoryId: '2102157', seq: '3', times: '2', k0: 'json-771', detailId: '8390132556' }),
        sourceName: '新浪财经', entryTypeId: '6200028', entryTypeName: '安发科技-列表', ver: '7', flag1: '2026-10-08',
        title: '', summary: '', acceptState: 'accepted',
      },
      showItems: [{ itemId: '1', columnName: 'K1', itemName: '文件名', value: '详情里的文件名.pdf' }],
      subs: [],
      subsCnt: 6,
    })
    const wrapper = await mountDrawer({
      file: file({ parentId: '88001', categoryId: '2102157', seq: '3', times: '2', k0: 'json-771', detailId: '8390132556' }),
    })

    expect(dataApi.rowDetail).toHaveBeenCalledWith('6200028', '7302555')
    expect(wrapper.get('[data-testid="file-detail-seq"]').text()).toBe('3')
    expect(wrapper.get('[data-testid="file-detail-times"]').text()).toBe('2')
    // 旧平台 base 的「版本」取 VER、「抓取日期」取 FLAG1，都在 entryDetail 返回行里
    expect(wrapper.get('[data-testid="file-detail-ver"]').text()).toBe('7')
    expect(wrapper.get('[data-testid="file-detail-flag1"]').text()).toBe('2026-10-08')
    // 子数据量用 subsCnt（子行总数），不是本页条数
    expect(wrapper.get('[data-testid="file-detail-subs"]').text()).toBe('6')
    // 类型ID/类型名也以返回行为准（旧平台详情顶部就是这一行）
    expect(wrapper.get('[data-testid="file-detail-tableName"]').text()).toBe('安发科技-列表')
    expect(wrapper.get('[data-testid="file-detail-fields"]').text()).toContain('详情里的文件名.pdf')
  })

  it('详情失败时保留列表字段，不把抽屉画空', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockRejectedValue(new Error('500'))
    const wrapper = await mountDrawer()

    expect(ElMessage.warning).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="file-detail-fields"]').text()).toContain('c37a9f1e.pdf')
    expect(wrapper.get('[data-testid="file-detail-dataId"]').text()).toBe('7302555')
  })

  it('K2 外链打开（完整地址即链接文案），K3 预览关掉详情再交给调用方', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const wrapper = await mountDrawer()

    const k2 = wrapper.get('[data-testid="file-detail-k2"]')
    expect(k2.attributes('href')).toBe('https://files.example.com/a.pdf')
    // 不能只给「打开」两字：要看得到完整地址（旧 BaseDetail 就是拿值当链接文案）
    expect(k2.text()).toBe('https://files.example.com/a.pdf')
    expect(k2.text()).toBe(k2.attributes('href'))
    await wrapper.get('[data-testid="file-detail-k3-preview"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
    expect(wrapper.emitted('preview')?.[0]?.[0]).toMatchObject({ dataId: '7302555' })
  })

  it('任务 ID 打开任务实例弹窗，原始 JSON 新开 readJson', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const wrapper = await mountDrawer({
      file: file({ detailId: '8390132556', k0: 'json-771' }),
    })

    await wrapper.get('[data-testid="file-detail-detailId"]').trigger('click')
    const dialog = wrapper.getComponent(TaskInstStub)
    expect(dialog.props('taskId')).toBe('8390132556')
    expect(dialog.props('sourceId')).toBe('430016824')
    expect(dialog.props('modelValue')).toBe(true)

    await wrapper.get('[data-testid="file-detail-k0"]').trigger('click')
    expect(open).toHaveBeenCalledWith('/api/v1/readJson?sourceId=430016824&id=json-771', '_blank')
  })

  it('父 ID 在抽屉内换成上游数据，可返回当前文件', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockImplementation(async (_tableId, dataId) => {
      if (dataId === '88001') {
        return {
          row: { dataId: '88001', sourceId: '430016824', title: '', summary: '', acceptState: 'accepted' as const },
          showItems: [{ columnName: 'K1', itemName: '标题', value: '上游标题' }],
        }
      }
      return {
        row: {
          ...file({ parentId: '88001', categoryId: '2102157' }),
          title: '', summary: '', acceptState: 'accepted' as const,
        },
        showItems: [],
      }
    })
    const wrapper = await mountDrawer({
      file: file({ parentId: '88001', categoryId: '2102157' }),
    })

    await wrapper.get('[data-testid="file-detail-parentId"]').trigger('click')
    await flushPromises()
    expect(dataApi.rowDetail).toHaveBeenCalledWith('2102157', '88001')
    expect(wrapper.get('[data-testid="file-detail-parent"]').text()).toContain('88001')
    expect(wrapper.get('[data-testid="file-detail-fields"]').text()).toContain('上游标题')

    await wrapper.get('[data-testid="file-detail-parent"]').find('button').trigger('click')
    expect(wrapper.find('[data-testid="file-detail-parent"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="file-detail-dataId"]').text()).toBe('7302555')
  })

  // 2026-10-16 「源名称没正确展示」：FileView 那条路径传进来的 sourceName 是画布上下文的
  // 源名（数据视图里通常为空），父组件没给时要自己按 sourceId 查一次源详情。
  it('父组件没给源名时按 sourceId 兜底查源详情', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const detail = vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue({ name: '安发科技(兜底)' } as never)
    const wrapper = await mountDrawer({ sourceName: '' })

    expect(detail).toHaveBeenCalledWith('430016824')
    expect(wrapper.get('[data-testid="file-detail-sourceName"]').text()).toBe('安发科技(兜底)')
  })

  // entryDetail 返回行自带的 SOURCE_NAME 才是权威值（旧平台详情顶部那列就是它），
  // 而且它比父组件传进来的源名更靠谱——有它就不必再打 sourceDetail。
  it('返回行自带 SOURCE_NAME 时优先用它，且不再兜底请求', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue({
      row: { ...file(), sourceName: '新浪财经', title: '', summary: '', acceptState: 'accepted' },
      showItems: [],
    })
    const detail = vi.spyOn(sourceApi, 'sourceDetail').mockResolvedValue(null)
    const wrapper = await mountDrawer()

    expect(wrapper.get('[data-testid="file-detail-sourceName"]').text()).toBe('新浪财经')
    expect(detail).not.toHaveBeenCalled()
  })

  it('源详情也拿不到时，源名称退化成源 ID 而不是「—」', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    vi.spyOn(sourceApi, 'sourceDetail').mockRejectedValue(new Error('500'))
    const wrapper = await mountDrawer({ sourceName: '' })

    expect(wrapper.get('[data-testid="file-detail-sourceName"]').text()).toBe('430016824')
  })

  // 2026-10-16 「父ID没正确展示」：旧平台 baseOtherCols 直接出 PARENT_ID 原值，
  // 顶层行的 0 也照显；能不能点由 canDrillParent 决定，不影响显示。
  it('父 ID 顶层行为 0 时照显原值且不可点', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const wrapper = await mountDrawer({ file: file({ parentId: '0', categoryId: '2102157' }) })

    const parentId = wrapper.get('[data-testid="file-detail-parentId"]')
    expect(parentId.text()).toBe('0')
    expect(parentId.element.tagName).toBe('SPAN')
  })
})
