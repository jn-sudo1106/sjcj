// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import DataCondBuilder from './DataCondBuilder.vue'

const fields = [
  { prop: 'title', columnName: 'K1', desc: '标题', type: 'string' },
  { prop: 'count', columnName: 'K8', desc: '数量', type: 'number' },
]

describe('DataCondBuilder', () => {
  it('构造器生成带引号的 LIKE，点高级切到裸 SQL', async () => {
    const wrapper = mount(DataCondBuilder, { props: { modelValue: '', fields } })
    await wrapper.get('[data-testid="data-cond-field"]').setValue('title')
    await wrapper.get('[data-testid="data-cond-op"]').setValue('LIKE')
    await wrapper.get('[data-testid="data-cond-value"]').setValue('金融')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe("K1 LIKE '%金融%'")

    await wrapper.get('[data-testid="data-cond-advanced"]').trigger('click')
    expect(wrapper.get('[data-testid="data-cond-sql"]').element).toBeTruthy()
  })

  it('手改非法 SQL 后切回构造器停在高级模式', async () => {
    const wrapper = mount(DataCondBuilder, { props: { modelValue: "K1 LIKE 金融", fields } })
    expect(wrapper.find('[data-testid="data-cond-sql"]').exists()).toBe(true)
    await wrapper.get('[data-testid="data-cond-advanced"]').trigger('click')
    expect(wrapper.find('[data-testid="data-cond-sql"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('无法解析')
  })
})
