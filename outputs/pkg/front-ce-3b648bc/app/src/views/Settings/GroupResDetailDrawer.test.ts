// 规则详情抽屉：STRUCT 的 condJson 可读化（字段中文名 + op + 值）、编译产物折叠展示、
// 组显示「名称（ID）」（本机自录映射）、SQL 存量规则只读标注。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import GroupResDetailDrawer from './GroupResDetailDrawer.vue'
import { setGroupName } from '@/utils/groupNames'
import type { GroupResMeta, GroupResRule } from '@/api/groupRes'

const META: GroupResMeta = {
  resTypes: [
    {
      key: 'CATEGORY', name: '目录', baseTable: 'cfg_category', idColumn: 'CATEGORY_ID',
      fields: [{ field: 'CATEGORY_ID', name: '目录ID', type: 'num', ops: ['IN', '='], valueFrom: 'categoryTree' }],
    },
  ],
  actions: [{ key: 'ACCEPT', name: '入选' }],
  condTypes: [{ key: 'ID', name: 'ID列表' }, { key: 'STRUCT', name: '结构化条件' }, { key: 'SQL', name: 'SQL条件' }],
}

const STRUCT_RULE: GroupResRule = {
  id: 17, groupId: 100001, action: 'ACCEPT', resType: 'CATEGORY', condType: 'STRUCT',
  resCond: 'CATEGORY_ID IN (9009387,9009250)',
  condJson: '[{"field":"CATEGORY_ID","op":"IN","values":["9009387","9009250"]}]',
  remarks: null, isDelete: 0,
}

const SQL_RULE: GroupResRule = {
  id: 15, groupId: 100002, action: 'ACCEPT', resType: 'CATEGORY', condType: 'SQL',
  resCond: 'CATEGORY_ID > 9009387', condJson: null, remarks: null, isDelete: 0,
}

async function mountDrawer(rule: GroupResRule) {
  const wrapper = mount(GroupResDetailDrawer, {
    props: { modelValue: true, rule, meta: META },
    global: { plugins: [ElementPlus] },
  })
  await flushPromises()
  // el-drawer 的内容懒渲染：要等打开过渡结束（after-enter）才 mount 默认插槽；jsdom 里手动触发
  wrapper.findComponent({ name: 'ElDrawer' }).vm.$emit('after-enter')
  await flushPromises()
  return wrapper
}

describe('GroupResDetailDrawer', () => {
  beforeEach(() => localStorage.clear())

  it('STRUCT：condJson 渲染成可读条件行（字段中文名 + op + 值），resCond 标注为编译产物', async () => {
    const wrapper = await mountDrawer(STRUCT_RULE)
    const rows = wrapper.get('[data-testid="group-res-detail-condrows"]')
    expect(rows.text()).toContain('目录ID（CATEGORY_ID）')
    expect(rows.text()).toContain('IN')
    expect(rows.text()).toContain('9009387, 9009250')
    expect(wrapper.text()).toContain('编译产物')
    expect(wrapper.text()).toContain('CATEGORY_ID IN (9009387,9009250)')
  })

  it('组显示「名称（ID）」：已录组名带名称，未录回退裸 ID', async () => {
    setGroupName(100001, '研发一组')
    expect((await mountDrawer(STRUCT_RULE)).get('[data-testid="group-res-detail-group"]').text()).toBe('研发一组（100001）')
    expect((await mountDrawer(SQL_RULE)).get('[data-testid="group-res-detail-group"]').text()).toBe('100002')
  })

  it('SQL 存量规则：条件原样展示 + 「已停止编辑」标注，不渲染条件行', async () => {
    const wrapper = await mountDrawer(SQL_RULE)
    expect(wrapper.find('[data-testid="group-res-detail-sql-readonly"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="group-res-detail-condrows"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('CATEGORY_ID > 9009387')
  })

  it('condJson 脏数据（非法 JSON）：不炸，回退展示 resCond 与 JSON 原文', async () => {
    const wrapper = await mountDrawer({ ...STRUCT_RULE, condJson: '{oops' })
    expect(wrapper.find('[data-testid="group-res-detail-condrows"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('{oops')
    expect(wrapper.text()).toContain('CATEGORY_ID IN (9009387,9009250)')
  })
})
