// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import DataFetchApiDialog from './DataFetchApiDialog.vue'

const params = ['appId', 'appKey', 'type', 'sourceId', 'size', 'startId', 'endId'].map((name) => ({ name, type: '-', required: '-', limit: '-', description: name }))
const returns = [
  { code: 'data.lastId', name: '本次最大 ID', type: '-', description: '-' },
  { code: 'data.list[].id', name: 'ID', type: '-', description: '-' },
  { code: 'data.list[].k11', name: 'K11', type: '-', description: '-' },
]
const base = { modelValue: true, url: 'http://h/rest/api/v1/data/entry?type=1', params, returns }

async function mountDialog(props: Record<string, unknown> = {}) {
  const w = mount(DataFetchApiDialog, { props: { ...base, ...props }, global: { plugins: [ElementPlus] }, attachTo: document.body })
  await flushPromises()
  return w
}

// 2026-11-26：有条件时只讲 qs 一个接口，参数 / 返回字段不能和 ID 分批取数混在一起
describe('DataFetchApiDialog 条件模式', () => {
  it('无条件：维持 ID 分批取数原样', async () => {
    const w = await mountDialog()
    const text = document.body.textContent ?? ''
    expect(text).toContain('ID 分批取数')
    expect(text).toContain('startId')
    expect(text).toContain('data.lastId')
    expect(document.querySelector('[data-testid="data-api-id-alt"]')).toBeNull()
    w.unmount()
  })

  it('有条件：主地址换成 qs，参数与返回字段按 qs 口径，ID 取数收成备用一行', async () => {
    const w = await mountDialog({ conditionUrl: 'http://h/rest/api/v1/data/qs?type=1&more=K11%3D1&page=1&size=20', condition: 'K11=1' })
    expect(document.querySelector('[data-testid="data-api-condition-url"]')?.textContent).toContain('/data/qs')
    expect(document.querySelector('[data-testid="data-api-id-alt"]')?.textContent).toContain('/data/entry')
    const fieldCodes = [...document.querySelectorAll('.dap-field')].map((el) => el.textContent)
    expect(fieldCodes).toEqual(expect.arrayContaining(['more', 'page', 'size', 'data.total', 'data.pageMax', 'data.list[].k11']))
    expect(fieldCodes).not.toContain('startId')
    expect(fieldCodes).not.toContain('endId')
    expect(fieldCodes).not.toContain('data.lastId')
    w.unmount()
  })
})
