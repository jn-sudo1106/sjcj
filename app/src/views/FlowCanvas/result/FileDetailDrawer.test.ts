// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import FileDetailDrawer from './FileDetailDrawer.vue'
import { dataApi, type DataTableMeta, type FileResourceRecord } from '@/api'

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
      stubs: { ElDrawer: ElDrawerStub, TaskInstDialog: TaskInstStub },
    },
  })
  await flushPromises()
  return wrapper
}

describe('FileDetailDrawer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('右侧 560px，系统标识两列，源 ID / 类型 ID 是纯文本', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const wrapper = await mountDrawer()

    expect(wrapper.get('.drawer-stub').attributes('data-size')).toBe('560px')
    expect(wrapper.get('[data-testid="file-detail-sourceId"]').text()).toBe('430016824')
    expect(wrapper.get('[data-testid="file-detail-sourceId"]').element.tagName).toBe('SPAN')
    expect(wrapper.get('[data-testid="file-detail-tableId"]').text()).toBe('6200028')
    expect(wrapper.get('[data-testid="file-detail-tableId"]').element.tagName).toBe('SPAN')
    expect(wrapper.get('[data-testid="file-detail-sourceName"]').text()).toBe('安发科技')
    expect(wrapper.get('[data-testid="file-detail-tableName"]').text()).toBe('file_resource')
    expect(wrapper.text()).toContain('标识')
    expect(wrapper.text()).toContain('业务字段')
  })

  it('业务字段按表结构渲染，QUERYID 进折叠的其他列', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const wrapper = await mountDrawer()

    const main = wrapper.get('[data-testid="file-detail-fields"]').text()
    expect(main).toContain('文件名')
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
        title: '', summary: '', acceptState: 'accepted',
      },
      showItems: [{ itemId: '1', columnName: 'K1', itemName: '文件名', value: '详情里的文件名.pdf' }],
      subs: [],
    })
    const wrapper = await mountDrawer({
      file: file({ parentId: '88001', categoryId: '2102157', seq: '3', times: '2', k0: 'json-771', detailId: '8390132556' }),
    })

    expect(dataApi.rowDetail).toHaveBeenCalledWith('6200028', '7302555')
    expect(wrapper.get('[data-testid="file-detail-seq"]').text()).toBe('3')
    expect(wrapper.get('[data-testid="file-detail-times"]').text()).toBe('2')
    expect(wrapper.get('[data-testid="file-detail-subs"]').text()).toBe('0')
    expect(wrapper.get('[data-testid="file-detail-fields"]').text()).toContain('详情里的文件名.pdf')
  })

  it('详情失败时保留列表字段，不把抽屉画空', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockRejectedValue(new Error('500'))
    const wrapper = await mountDrawer()

    expect(ElMessage.warning).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="file-detail-fields"]').text()).toContain('c37a9f1e.pdf')
    expect(wrapper.get('[data-testid="file-detail-dataId"]').text()).toBe('7302555')
  })

  it('K2 外链打开，K3 预览关掉详情再交给调用方', async () => {
    vi.spyOn(dataApi, 'rowDetail').mockResolvedValue(null)
    const wrapper = await mountDrawer()

    expect(wrapper.get('[data-testid="file-detail-k2"]').attributes('href')).toBe('https://files.example.com/a.pdf')
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
})
