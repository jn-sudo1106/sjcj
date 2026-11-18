// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StorageKindTag from './StorageKindTag.vue'

describe('StorageKindTag', () => {
  it.each([
    ['CK', 'CK', 'is-ck', '存储在 ClickHouse'],
    ['ck', 'CK', 'is-ck', '存储在 ClickHouse'],
    ['MYSQL', 'MYSQL', 'is-mysql', '存储在 MySQL'],
    [undefined, 'MYSQL', 'is-mysql', '存储在 MySQL'],
    [null, 'MYSQL', 'is-mysql', '存储在 MySQL'],
  ])('%s → %s', (kind, text, cls, title) => {
    const wrapper = mount(StorageKindTag, { props: { kind } })
    expect(wrapper.text()).toBe(text)
    expect(wrapper.classes()).toContain(cls)
    expect(wrapper.attributes('title')).toBe(title)
  })
})
