// @vitest-environment jsdom
// 向量表数据浏览 · 单窗口查询区接线回归（旧 ai-chat-view src/demo/VectorDataShow.vue）。钉住旧口径：
// ① 挂载即拉向量表下拉（config/all?name=），选项文案是 `名称[备注]`；
// ② 查询按旧 queryParam 原样发出（input/type/pageSize=20/pageNo=1，旧页面没有分页控件、也没有必填校验，
//    未选表也能直接查）；返回的 data 整份 JSON.stringify(x, null, 2) 打进下面的大文本框；
// ③ 与旧版的有意偏差：请求失败要提示（旧版裸 promise 静默），且失败时保留上一次结果。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import VectorDataPanel from './VectorDataPanel.vue'
import { pocVectorConfigList, pocVectorDataQuery } from '@/api/templateConfig'

const VECTOR_TABLES = [
  { id: 1, name: 'DIM_JG_VECTOR', comment: '机构向量表', sourceTable: 'sense_data.DIM_JG' },
  { id: 2, name: 'KHFA_ZB_VECTOR', comment: '客户指标向量表', sourceTable: 'sense_data.KHFA_KHZBJG_JG' },
]

const ROWS = [
  { id: 101, code: 'JG001', name: '杭州分行', alias: 'hangzhou branch', score: 0.93 },
  { id: 102, code: 'JG002', name: '宁波分行', alias: 'ningbo branch', score: 0.81 },
]

vi.mock('@/api/templateConfig', () => ({
  pocVectorConfigList: vi.fn(async () => VECTOR_TABLES.map((row) => ({ ...row }))),
  pocVectorDataQuery: vi.fn(async () => ROWS.map((row) => ({ ...row }))),
}))

function mountPanel() {
  return mount(VectorDataPanel, { global: { plugins: [ElementPlus] } })
}

function resultArea(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.find<HTMLTextAreaElement>('.vd-result textarea')
}

function clickQuery(wrapper: ReturnType<typeof mountPanel>) {
  const button = wrapper.findAll('button').find((b) => b.text() === '查询')!
  button.trigger('click')
}

beforeEach(() => {
  vi.mocked(pocVectorConfigList).mockClear()
  vi.mocked(pocVectorDataQuery).mockClear()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('向量表数据浏览 · 查询窗口', () => {
  it('挂载即按旧口径拉向量表下拉，并渲染成 `名称[备注]` 选项', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(pocVectorConfigList).toHaveBeenCalledWith('')

    await wrapper.find('.vd-table-select input').trigger('click')
    await flushPromises()
    const items = Array.from(document.body.querySelectorAll('.el-select-dropdown__item')).map((el) => el.textContent?.trim())
    expect(items).toEqual(['DIM_JG_VECTOR[机构向量表]', 'KHFA_ZB_VECTOR[客户指标向量表]'])
  })

  it('查询按旧 queryParam 发出，结果整份 JSON 打进结果框（结果框只读）', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    const select = wrapper.findAllComponents({ name: 'ElSelect' })[0]!
    select.vm.$emit('update:modelValue', 'DIM_JG_VECTOR')
    await wrapper.find('.vd-input-text textarea').setValue('杭州')
    clickQuery(wrapper)
    await flushPromises()

    expect(pocVectorDataQuery).toHaveBeenCalledWith({ input: '杭州', type: 'DIM_JG_VECTOR', pageSize: 20, pageNo: 1 })
    expect(resultArea(wrapper).element.value).toBe(JSON.stringify(ROWS, null, 2))
    expect(resultArea(wrapper).attributes('readonly')).toBeDefined()
  }, 45000)

  it('未选表也能直接查询（旧页面没有必填校验，type 空串照发）', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    clickQuery(wrapper)
    await flushPromises()
    expect(pocVectorDataQuery).toHaveBeenCalledWith({ input: '', type: '', pageSize: 20, pageNo: 1 })
  })

  it('查询失败：提示后端消息，结果框保留上一次内容', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    clickQuery(wrapper)
    await flushPromises()
    expect(resultArea(wrapper).element.value).toBe(JSON.stringify(ROWS, null, 2))

    vi.mocked(pocVectorDataQuery).mockRejectedValueOnce(new Error('向量表不存在'))
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({}) as never)
    clickQuery(wrapper)
    await flushPromises()

    expect(error).toHaveBeenCalledWith('向量表不存在')
    expect(resultArea(wrapper).element.value).toBe(JSON.stringify(ROWS, null, 2))
  }, 45000)

  it('下拉数据加载失败：提示后端消息且下拉回空列表', async () => {
    vi.mocked(pocVectorConfigList).mockRejectedValueOnce(new Error('POC 服务不可用'))
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({}) as never)

    const wrapper = mountPanel()
    await flushPromises()
    expect(error).toHaveBeenCalledWith('POC 服务不可用')

    await wrapper.find('.vd-table-select input').trigger('click')
    await flushPromises()
    expect(Array.from(document.body.querySelectorAll('.el-select-dropdown__item'))).toHaveLength(0)
  }, 45000)
})
