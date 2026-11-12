// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RowDetailFields from './RowDetailFields.vue'
import { fieldsFromShowItems, fieldsFromTableMeta, isBlankDetailValue, safeHttpUrl } from './rowDetailFields'

const fields = fieldsFromTableMeta(
  [
    { prop: 'title', type: 'string', desc: '标题', columnName: 'K1' },
    { prop: 'url', type: 'string', desc: 'URL', columnName: 'K2' },
    { prop: 'content_path', type: 'string', desc: '正文路径', columnName: 'K6' },
    { prop: 'author', type: 'string', desc: '作者', columnName: 'K5' },
    { prop: 'tags', type: 'string', desc: '标签', columnName: 'K9' },
  ],
  {
    K1: '年轻人的超拉风小钢炮',
    K2: 'https://www.hxdsb.com/a/123',
    K6: '/qinlong/news/a.html',
    K5: '',
    K9: '   ',
  },
)

describe('rowDetailFields', () => {
  it('空串和空白当空，物理列名取值，http(s) 出链接，OSS 路径可预览', () => {
    expect(isBlankDetailValue('')).toBe(true)
    expect(isBlankDetailValue('  ')).toBe(true)
    expect(isBlankDetailValue(0)).toBe(false)
    expect(safeHttpUrl('https://www.hxdsb.com/a')).toBe('https://www.hxdsb.com/a')
    expect(safeHttpUrl('javascript:alert(1)')).toBe('')

    const byProp = Object.fromEntries(fields.map((field) => [field.prop, field]))
    expect(byProp.title).toMatchObject({ empty: false, value: '年轻人的超拉风小钢炮' })
    expect(byProp.url.href).toBe('https://www.hxdsb.com/a/123')
    expect(byProp.content_path.filePath).toBe('/qinlong/news/a.html')
    expect(byProp.author.empty).toBe(true)
    expect(byProp.tags.empty).toBe(true)
  })

  it('上游 showItems 同样标空字段', () => {
    const items = fieldsFromShowItems([
      { columnName: 'K1', itemName: '标题', value: '上游标题' },
      { columnName: 'K2', itemName: '作者', value: '' },
    ])
    expect(items[0]).toMatchObject({ name: '标题', value: '上游标题', empty: false })
    expect(items[1].empty).toBe(true)
  })
})

describe('RowDetailFields', () => {
  it('默认藏空字段，底部提示另有空字段；开关由调用方受控', async () => {
    const wrapper = mount(RowDetailFields, { props: { fields } })

    expect(wrapper.text()).toContain('已填 3 / 5')
    expect(wrapper.text()).toContain('另有 2 个空字段已隐藏')
    expect(wrapper.find('[data-testid="row-detail-empty-toggle"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="row-detail-field-title"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="row-detail-field-author"]').exists()).toBe(false)
    expect(wrapper.get('a.rdf-link').attributes('href')).toBe('https://www.hxdsb.com/a/123')

    await wrapper.setProps({ showEmpty: true })
    expect(wrapper.find('[data-testid="row-detail-field-author"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="row-detail-hidden-hint"]').exists()).toBe(false)
  })

  it('visibleProps 只展示指定字段；编辑态忽略过滤强制全字段', () => {
    const wrapper = mount(RowDetailFields, {
      props: { fields, visibleProps: ['title'], showEmpty: true },
    })
    expect(wrapper.find('[data-testid="row-detail-field-title"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="row-detail-field-url"]').exists()).toBe(false)
  })

  it('编辑态展示全部字段，不受 visibleProps / showEmpty 影响', () => {
    const wrapper = mount(RowDetailFields, {
      props: { fields, editing: true, values: { title: '年轻人的超拉风小钢炮', author: '' }, visibleProps: ['title'] },
    })
    expect(wrapper.find('[data-testid="row-detail-field-author"]').exists()).toBe(true)
    expect(wrapper.find('input[aria-label="作者"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('编辑时展示全部字段')
  })

  it('编辑态字段有值时显示清空按钮并带有清空字样提示，点击清空派发 update:field 为空串', async () => {
    const wrapper = mount(RowDetailFields, {
      props: { fields, editing: true, values: { title: '年轻人的超拉风小钢炮', author: '' } },
    })

    const titleField = wrapper.find('[data-testid="row-detail-field-title"]')
    const clearBtn = titleField.find('[data-testid="row-detail-clear"]')
    expect(clearBtn.exists()).toBe(true)
    expect(clearBtn.attributes('title')).toBe('清空')
    expect(clearBtn.attributes('aria-label')).toBe('清空')

    // 空字段不显示清空按钮
    const authorField = wrapper.find('[data-testid="row-detail-field-author"]')
    expect(authorField.find('[data-testid="row-detail-clear"]').exists()).toBe(false)

    // 点击清空
    await clearBtn.trigger('mousedown')
    const emitted = wrapper.emitted('update:field')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([{ prop: 'title', value: '' }])
  })
})

// 物理列名 K1/K2…（2026-09-09）：写 SQL 条件、配规则用的是它，详情此前只有 prop，
// 与表格列头「标题-K1」对不上。
describe('详情字段的物理列名', () => {
  it('fieldsFromTableMeta 带出 columnName，右侧渲染成「prop · K1」', () => {
    expect(fields.find((f) => f.prop === 'title')?.columnName).toBe('K1')
    expect(fields.find((f) => f.prop === 'url')?.columnName).toBe('K2')

    const wrapper = mount(RowDetailFields, { props: { fields, showEmpty: true } })
    const head = wrapper.find('[data-testid="row-detail-field-title"] .rdf-code')
    expect(head.text().replace(/\s+/g, ' ')).toBe('title · K1')
  })

  it('showItems 路径的 code 本来就是 K 名，不再重复塞 columnName（否则渲染成「K1 · K1」）', () => {
    const built = fieldsFromShowItems([{ columnName: 'K1', itemName: '标题', value: '上游标题' }])
    expect(built[0].code).toBe('K1')
    expect(built[0].columnName).toBeUndefined()

    const wrapper = mount(RowDetailFields, { props: { fields: built, showEmpty: true } })
    expect(wrapper.find('.rdf-code').text().replace(/\s+/g, ' ')).toBe('K1')
  })

  it('没有 columnName 的字段只显示 code，不留孤零零的分隔点', () => {
    const built = fieldsFromTableMeta([{ prop: 'ENTRY_ID', type: 'string', desc: '数据 ID' }], { ENTRY_ID: '1' })
    expect(built[0].columnName).toBeUndefined()
    const wrapper = mount(RowDetailFields, { props: { fields: built, showEmpty: true } })
    expect(wrapper.find('.rdf-code').text().trim()).toBe('ENTRY_ID')
    expect(wrapper.find('.rdf-code').text()).not.toContain('·')
  })

  it('传入 row 时自动补出 ENTRY_ID 字段，且渲染排在最前面', () => {
    const built = fieldsFromTableMeta(
      [{ prop: 'title', type: 'string', desc: '标题', columnName: 'K1' }],
      { K1: '新闻标题' },
      { dataId: '430114955', sourceId: 'src-1' } as any,
    )
    expect(built[0]).toMatchObject({
      prop: 'ENTRY_ID',
      code: 'ENTRY_ID',
      name: 'ENTRY_ID',
      value: '430114955',
      empty: false,
    })
    const wrapper = mount(RowDetailFields, { props: { fields: built, showEmpty: true } })
    expect(wrapper.find('[data-testid="row-detail-field-ENTRY_ID"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="row-detail-field-ENTRY_ID"]').text()).toContain('430114955')
  })

  it('fieldsFromShowItems 传入 row 时同样自动补出 ENTRY_ID', () => {
    const built = fieldsFromShowItems(
      [{ columnName: 'K1', itemName: '标题', value: '上游标题' }],
      { dataId: 'parent-999' } as any,
    )
    expect(built[0]).toMatchObject({
      prop: 'ENTRY_ID',
      code: 'ENTRY_ID',
      value: 'parent-999',
    })
  })

  it('点击字段复制按钮，调用 copyToClipboard 复制字段值', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mount(RowDetailFields, { props: { fields, showEmpty: true } })
    const copyBtn = wrapper.find('[data-testid="row-detail-field-title"] [data-testid="row-detail-copy"]')
    expect(copyBtn.exists()).toBe(true)
    await copyBtn.trigger('click')
    expect(writeText).toHaveBeenCalledWith('年轻人的超拉风小钢炮')
  })

  it('点击复制全部 JSON 按钮，调用 copyToClipboard 复制所有已填字段 JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const wrapper = mount(RowDetailFields, { props: { fields } })
    const copyAllBtn = wrapper.find('[data-testid="row-detail-copy-all"]')
    expect(copyAllBtn.exists()).toBe(true)
    await copyAllBtn.trigger('click')
    expect(writeText).toHaveBeenCalled()
    const payload = JSON.parse(writeText.mock.calls[0][0])
    expect(payload.title).toBe('年轻人的超拉风小钢炮')
    expect(payload.url).toBe('https://www.hxdsb.com/a/123')
  })
})

