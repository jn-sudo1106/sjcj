import { describe, expect, it } from 'vitest'
import { mockTaskListPaged } from './taskList'

// 任务实例页 mock（逻辑名 task/taskListPaged）：筛选口径必须和后端 topTaskPaged 一致，
// 否则离线预览 / vitest 关 live 时会看到「填了筛选没反应」的假象。
// 数据是静态的（没有写操作），所以这里不涉及用例间清理。
describe('任务实例 mock：筛选与分页', () => {
  it('默认（不带 all）返回全部**非展示类**记录，顺序即内存表顺序', () => {
    const res = mockTaskListPaged({ page: 1, limit: 100 })
    // 1001 / 1002 两条展示类任务规格被排除（all !== '1'）
    expect(res.total).toBe(5)
    expect(res.list[0].taskId).toBe('8348509120')
    expect(res.list.every((r) => !['1001', '1002', '1007'].includes(String(r.taskSpecId)))).toBe(true)
  })

  it('all=1 → 不再排除展示类任务规格', () => {
    const all = mockTaskListPaged({ all: '1', page: 1, limit: 100 })
    expect(all.total).toBe(7)
  })

  it('按 state / sourceId / taskId / taskTopic / configId 精确或模糊筛选', () => {
    // 注意：不带 all 时展示类规格先被排除，所以状态 C 只剩 8348509120（C 的展示类那条被排掉）
    expect(mockTaskListPaged({ state: 'C' }).list.map((r) => r.taskId)).toEqual(['8348509120'])
    expect(mockTaskListPaged({ state: 'C', all: '1' }).list.map((r) => r.taskId)).toEqual(['8348509120', '8348509188'])
    expect(mockTaskListPaged({ state: 'E' }).list.map((r) => r.taskId)).toEqual(['8348509140'])
    expect(mockTaskListPaged({ sourceId: '161725' }).list.map((r) => r.taskId)).toEqual(['8348509120', '8348509131'])
    expect(mockTaskListPaged({ taskId: '8348509131' }).list.map((r) => r.taskId)).toEqual(['8348509131'])
    expect(mockTaskListPaged({ taskTopic: 'clean' }).list.map((r) => r.taskId)).toEqual(['8348509160'])
    expect(mockTaskListPaged({ configId: '70812' }).list.map((r) => r.taskId)).toEqual(['8348509160'])
  })

  it('sourceIds 按逗号拆分做精确匹配（旧页「源IDs」栏）', () => {
    expect(mockTaskListPaged({ sourceIds: '161725, 161900' }).list.map((r) => r.taskId)).toEqual([
      '8348509120', '8348509131', '8348509160',
    ])
  })

  it('创建时间范围按 createDt 的日期部分过滤（宽范围全中 / 未来范围为空）', () => {
    // 用宽范围断言「范围过滤本身不误伤」，避免依赖「mock 记录的 createDt 一定在今天」这种时间敏感假设
    const wide = mockTaskListPaged({ startTime: '2000-01-01', endTime: '2999-12-31', all: '1', page: 1, limit: 100 })
    expect(wide.total).toBe(7)
    const future = mockTaskListPaged({ startTime: '2999-01-01', endTime: '2999-12-31', all: '1', page: 1, limit: 100 })
    expect(future.total).toBe(0)
  })

  it('分页切页（默认 limit=20，本页数据一页放得下）', () => {
    const p1 = mockTaskListPaged({ page: 1, limit: 2 })
    expect(p1.total).toBe(5)
    expect(p1.list).toHaveLength(2)
    const p3 = mockTaskListPaged({ page: 3, limit: 2 })
    expect(p3.list).toHaveLength(1)
  })
})
