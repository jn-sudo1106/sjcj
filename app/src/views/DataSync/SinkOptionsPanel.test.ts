// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SinkOptionsPanel from './SinkOptionsPanel.vue'
import {
  isSinkTarget, renderSinkDefaults, sanitizeSinkOptions, sinkPreviewLines,
  type SyncColumnMap, type SyncSinkOptions,
} from '@/api/dataSync'

const columns: SyncColumnMap[] = [
  { key: 1, no: 1, sourceColumn: 'ID', targetColumn: 'id', targetColumnType: 'bigint', distinct: true },
  { key: 2, no: 2, sourceColumn: 'ENTRY_ID', targetColumn: 'entry_id', targetColumnType: 'varchar', remark: '批次号', distinct: true },
  { key: 3, no: 3, sourceColumn: 'NAME', targetColumn: 'name', targetColumnType: 'varchar', remark: '名称' },
  { key: 4, no: 4, sourceColumn: 'UPDATE_DT', targetColumn: 'origin_update_time', targetColumnType: 'varchar' },
]

/** 宿主照抄向导的用法：v-if 控制存在、:key 让切目标端类型时重建面板、v-model 回传参数 */
const Host = defineComponent({
  components: { SinkOptionsPanel },
  setup() {
    const databaseType = ref(4)
    const options = ref<SyncSinkOptions | null>(renderSinkDefaults(4, columns))
    const mapped = ref<SyncColumnMap[]>([...columns])
    return { databaseType, options, mapped, isSinkTarget, renderSinkDefaults }
  },
  template: `<SinkOptionsPanel v-if="isSinkTarget(databaseType)" :key="databaseType" v-model="options"
    :database-type="databaseType" :columns="mapped" target-schema="gzh_db" target-table="t_holding_detail" />`,
})

async function mountHost(databaseType: number, mapped?: SyncColumnMap[]) {
  const wrapper = mount(Host, {
    attachTo: document.body,
    global: { plugins: [ElementPlus], stubs: { transition: false } },
  })
  wrapper.vm.databaseType = databaseType
  wrapper.vm.mapped = mapped ?? columns
  wrapper.vm.options = renderSinkDefaults(databaseType, wrapper.vm.mapped)
  // 换目标端类型要走一次重渲染，面板 DOM 不是同步挂上的
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountHost>>

function preview(wrapper: Wrapper) {
  return wrapper.find('.sink-preview pre').text()
}

/** Element Plus 把 aria-label 落在内层 input 上，两种落点都认 */
function selectByLabel(wrapper: Wrapper, label: string) {
  const hit = wrapper.findAllComponents({ name: 'ElSelect' }).find((item) =>
    item.attributes('aria-label') === label || item.get('input').attributes('aria-label') === label)
  if (!hit) throw new Error(`找不到下拉：${label}`)
  return hit
}

function pick(wrapper: Wrapper, label: string, value: unknown) {
  selectByLabel(wrapper, label).vm.$emit('update:modelValue', value)
  return flushPromises()
}

/** dynamic 是单选按钮组，走 input[type=radio] 而不是下拉 */
async function pickRadio(wrapper: Wrapper, value: string) {
  const input = wrapper.findAll('input[type=radio]')
    .filter((item) => (item.element as HTMLInputElement).value === value)[0]
  if (!input) throw new Error(`找不到单选项：${value}`)
  await input.trigger('change')
  return flushPromises()
}

describe('SinkOptionsPanel', async () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('关系库目标端不渲染面板', async () => {
    expect((await mountHost(1)).find('.sink-panel').exists()).toBe(false)
  })

  it('ClickHouse 默认预览出正确引擎与去重列排序键', async () => {
    const wrapper = await mountHost(4)
    expect(preview(wrapper)).toContain('ENGINE = ReplacingMergeTree(update_time)')
    expect(preview(wrapper)).toContain('ORDER BY (`id`, `entry_id`)')
  })

  it('换成 MergeTree 后版本列禁用并提示不去重', async () => {
    const wrapper = await mountHost(4)
    await pick(wrapper, '表引擎', 'MergeTree')
    expect(preview(wrapper)).toContain('ENGINE = MergeTree()')
    expect(preview(wrapper)).toContain('不去重')
    expect(selectByLabel(wrapper, '版本列').props('disabled')).toBe(true)
  })

  it('显式排序键覆盖去重列并回传给宿主', async () => {
    const wrapper = await mountHost(4)
    await pick(wrapper, '排序键', ['entry_id'])
    expect(preview(wrapper)).toContain('ORDER BY (`entry_id`)')
    const submitted = sanitizeSinkOptions(wrapper.vm.options, 4)
    expect(submitted?.ck?.orderByColumns).toEqual(['entry_id'])
    expect(submitted?.es).toBeNull()
  })

  it('没勾去重列时预览直接说会被拒', async () => {
    const wrapper = await mountHost(4, [{ key: 9, no: 1, sourceColumn: 'NAME', targetColumn: 'name', targetColumnType: 'varchar' }])
    await flushPromises()
    expect(preview(wrapper)).toContain('服务端会拒绝保存')
  })

  it('ES 索引名留空按库表清洗，非法大写即时提示', async () => {
    const wrapper = await mountHost(5)
    const index = wrapper.find<HTMLInputElement>('[aria-label="索引名"]')
    expect(index.attributes('placeholder')).toBe('gzh_db_t_holding_detail')
    expect(preview(wrapper)).toContain('索引 gzh_db_t_holding_detail（单索引，不分区）')
    await index.setValue('My_Index')
    expect(wrapper.find('.sink-warn').text()).toContain('索引名必须小写')
  })

  it('ES 参数改动同时体现在预览与提交体里', async () => {
    const wrapper = await mountHost(5)
    await pick(wrapper, '分区粒度', 'day')
    await pick(wrapper, '_id 组成列', ['id'])
    await pickRadio(wrapper, 'false')
    expect(preview(wrapper)).toContain('按 day 分区')
    expect(preview(wrapper)).toContain('dynamic=false')
    expect(preview(wrapper)).toContain('_id 取 id')
    const submitted = sanitizeSinkOptions(wrapper.vm.options, 5)
    expect(submitted?.es?.indexPartition).toBe('day')
    expect(submitted?.es?.dynamic).toBe('false')
    expect(submitted?.ck).toBeNull()
  })

  it('字段覆盖行只在填了列名后才进提交体', async () => {
    const wrapper = await mountHost(5)
    const add = wrapper.findAll('button').filter((item) => item.text().includes('增加覆盖项'))[0]
    await add.trigger('click')
    await flushPromises()
    // 刚加的行还没选列，sanitize 必须把它丢掉，否则服务端会报「列覆盖  不在本次的目标列里」
    expect(sanitizeSinkOptions(wrapper.vm.options, 5)?.es?.fieldOverrides).toEqual([])
    const rowSelect = wrapper.findAllComponents({ name: 'ElSelect' })
      .filter((item) => item.props('placeholder') === '选择列')[0]
    rowSelect.vm.$emit('update:modelValue', 'name')
    await flushPromises()
    const overrides = sanitizeSinkOptions(wrapper.vm.options, 5)?.es?.fieldOverrides ?? []
    expect(overrides).toHaveLength(1)
    expect(overrides[0]).toMatchObject({ column: 'name', type: 'keyword' })
  })

  it('面板预览与 sinkPreviewLines 同源', async () => {
    const wrapper = await mountHost(5)
    await flushPromises()
    expect(preview(wrapper).split('\n')).toEqual(
      sinkPreviewLines(wrapper.vm.options, 5, 'gzh_db', 't_holding_detail', columns))
  })

  /** 向导里新建的表还不存在，不该出现「不会作用于已建好的表」这句提示 */
  it('只有编辑态（tableExists）才提示建表产物不作用于已有表', async () => {
    const props = { modelValue: renderSinkDefaults(4, columns), databaseType: 4, columns,
      targetSchema: 'gzh_db', targetTable: 't_holding' }
    const fresh = mount(SinkOptionsPanel, { props, global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(fresh.find('p.sink-warn').exists()).toBe(false)
    const editing = mount(SinkOptionsPanel, { props: { ...props, tableExists: true }, global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(editing.find('p.sink-warn').text()).toContain('不会改动已建好的表')
  })
})
