// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
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
})
