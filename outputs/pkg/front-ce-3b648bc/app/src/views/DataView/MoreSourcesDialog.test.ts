// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import ElementPlus from 'element-plus'
import MoreSourcesDialog from './MoreSourcesDialog.vue'
import { blankPickerFilter, pickerSourceQuery } from './sourcePickerQuery'
import { siteApi, sourceApi, sourceGroupApi, type Source } from '../../api'
import * as sourceDirs from '@/api/sourceDirs'
import { blankSourceListViewState, viewStateFilter } from '@/views/FlowCanvas/result/sourceListViewState'

describe('sourcePickerQuery · 与源管理同一口径（1021-05）', () => {
  it('状态 / 网站 / 来源组 / 名称 / 源 ID 的参数与源管理 viewStateFilter 完全一致', () => {
    for (const status of ['all', 'C', 'L', 'E', 'disabled'] as const) {
      const picker = pickerSourceQuery({ ...blankPickerFilter(), status, site: '-1', sourceGroup: '3', name: '贝壳', sourceIds: '1, 2' })
      const manage = viewStateFilter({
        ...blankSourceListViewState(),
        conditions: [
          { field: 'sourceIds', op: 'eq', value: '1,2' },
          { field: 'name', op: 'like', value: '贝壳' },
        ],
        site: '-1',
        sourceGroup: '3',
        status,
      })
      expect(picker, status).toEqual(manage)
    }
  })

  it('默认条件 = 源管理默认（全部状态，不带 enable / state）', () => {
    const q = pickerSourceQuery(blankPickerFilter())
    expect(q.enable).toBeUndefined()
    expect(q.state).toBeUndefined()
    expect(q.sourceIds).toBeUndefined()
  })

  it('在用 = 只带 enable=0；停用 = enable=1', () => {
    expect(pickerSourceQuery({ ...blankPickerFilter(), status: 'enabled' })).toMatchObject({ enable: '0', state: undefined })
    expect(pickerSourceQuery({ ...blankPickerFilter(), status: 'disabled' })).toMatchObject({ enable: '1', state: undefined })
  })

  it('系统目录走 categorys（调用方已含子级），业务目录与源 ID 取交集，对不上给空串', () => {
    expect(pickerSourceQuery(blankPickerFilter(), { categoryIds: ['10', '11'] }).categorys).toBe('10,11')
    expect(pickerSourceQuery({ ...blankPickerFilter(), sourceIds: '2 9' }, { sourceIds: ['1', '2', '3'] }).sourceIds).toBe('2')
    expect(pickerSourceQuery({ ...blankPickerFilter(), sourceIds: '9' }, { sourceIds: ['1'] }).sourceIds).toBe('')
  })
})

describe('MoreSourcesDialog', () => {
  let wrapper: VueWrapper
  let emitDir: ((scope: unknown) => void) | undefined
  const DirStub = defineComponent({
    emits: ['change', 'update:collapsed'],
    setup(_, { emit }) {
      emitDir = (scope) => emit('change', scope)
      return () => h('div', { class: 'dir-stub' })
    },
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function open(list: Source[] = []) {
    vi.spyOn(siteApi, 'sitePaged').mockResolvedValue({ total: 1, list: [{ siteId: '12', name: '公众号站' }] } as never)
    vi.spyOn(sourceGroupApi, 'list').mockResolvedValue([{ sourceGroupId: '3', sourceGroupName: '贝壳-城市站', state: 'ACTIVE' }] as never)
    vi.spyOn(sourceDirs, 'bizMembership').mockResolvedValue(new Map([['1', ['20']]]))
    const paged = vi.spyOn(sourceApi, 'sourcePaged').mockResolvedValue({ total: list.length, list })
    wrapper = mount(MoreSourcesDialog, {
      attachTo: document.body,
      props: { modelValue: false },
      global: { plugins: [ElementPlus], stubs: { SourceDirPanel: DirStub } },
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    return paged
  }

  it('打开时按源管理默认条件查（全部状态），不再默认只看在用', async () => {
    const paged = await open()
    expect(paged).toHaveBeenCalledTimes(1)
    const query = paged.mock.calls[0]![0]!
    expect(query.enable).toBeUndefined()
    expect(query.category).toBeUndefined()
    expect(query).toMatchObject({ page: 1, size: 20 })
  })

  it('启停与运行状态分两列：在用 / 停用 + 中文运行状态，名称从网站 / 来源组候选映射', async () => {
    await open([
      { sourceId: '1', name: '在用源', state: 'C', siteId: '12', sourceGroupId: '3' } as Source,
      { sourceId: '2', name: '停用源', state: 'C', disabled: true } as Source,
      { sourceId: '3', name: '怪状态', state: 'XX' } as Source,
    ])
    expect(wrapper.findAll('[data-testid="picker-enable"]').map((c) => c.text())).toEqual(['在用', '停用', '在用'])
    const run = wrapper.findAll('[data-testid="picker-run-state"]')
    expect(run.map((c) => c.text())).toEqual(['正常', '正常', 'XX'])
    expect(run[2]!.attributes('title')).toBe('未知状态：XX')
    expect(document.body.textContent).toContain('公众号站')
    expect(document.body.textContent).toContain('贝壳-城市站')
    // 业务目录列：同源管理，按源反查所在业务目录（目录名没加载过时用 #ID）
    expect(wrapper.findAll('[data-testid="picker-biz"]').map((c) => c.text())).toEqual(['#20', '—', '—'])
  })

  it('左侧系统目录按 categorys 筛，业务目录按目录里的源 ID 筛', async () => {
    const paged = await open()
    emitDir!({ kind: 'sys', dirIds: ['10', '11'], labels: [] })
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ categorys: '10,11', page: 1 }))

    vi.spyOn(sourceDirs, 'bizScopeSourceIds').mockResolvedValue(['7', '8'])
    emitDir!({ kind: 'biz', dirIds: ['20'], labels: [] })
    await flushPromises()
    expect(paged).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: '7,8' }))
    expect(paged.mock.lastCall![0]!.categorys).toBeUndefined()
  })
})
