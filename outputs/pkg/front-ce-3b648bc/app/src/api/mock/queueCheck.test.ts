import { describe, expect, it } from 'vitest'
import { mockMqCheckPaged } from './queueCheck'

// 队列告警 mock 的**读**路径：筛选口径（queue→queueName / name→queueDesc / enable→isDelete）
// 与表头排序（sortField + sortOrder='ascend'|'descend'）必须和后端契约一致，
// 否则本地 mock 演示会出现「点了表头箭头，数据顺序没变」的假象。
// 只跑读接口：paged 里 filter 出的新数组才排序，不会动到内存表顺序，因此用例之间无副作用。
describe('队列告警 mock：筛选与表头排序', () => {
  it('默认按内存表原顺序返回全部', () => {
    const res = mockMqCheckPaged({ page: 1, limit: 20 })
    expect(res.total).toBe(6)
    expect(res.list[0].queueId).toBe('mq-1')
  })

  it("queueName 升序 / 降序（ascend / descend 旧口径）", () => {
    const asc = mockMqCheckPaged({ sortField: 'queueName', sortOrder: 'ascend' })
    const names = asc.list.map((r) => r.queueName)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))

    const desc = mockMqCheckPaged({ sortField: 'queueName', sortOrder: 'descend' })
    expect(desc.list.map((r) => r.queueName)).toEqual([...names].reverse())
  })

  it('数值列按数字大小排序，不是按字符串（maxSize 1000 > 500，但字符串比较会反过来）', () => {
    const asc = mockMqCheckPaged({ sortField: 'maxSize', sortOrder: 'ascend' })
    const sizes = asc.list.map((r) => Number(r.maxSize))
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
    expect(sizes[0]).toBe(500) // 字符串比较会得到 "1000" < "500" 的错误顺序
  })

  it('未知 sortField 或非法 sortOrder 时忽略排序（脏参数不影响演示）', () => {
    expect(mockMqCheckPaged({ sortField: 'lastMsg', sortOrder: 'ascend' }).list[0].queueId).toBe('mq-1')
    expect(mockMqCheckPaged({ sortField: 'maxSize', sortOrder: 'ASC' }).list[0].queueId).toBe('mq-1')
    expect(mockMqCheckPaged({ sortField: 'maxSize' }).list[0].queueId).toBe('mq-1')
  })

  it('排序与筛选、分页叠加生效', () => {
    // enable='0' → isDelete=0 的 4 条，再按 maxRate 降序
    const res = mockMqCheckPaged({ enable: '0', sortField: 'maxRate', sortOrder: 'descend' })
    expect(res.total).toBe(4)
    const rates = res.list.map((r) => Number(r.maxRate))
    expect(rates).toEqual([...rates].sort((a, b) => b - a))
    expect(res.list.every((r) => r.isDelete === 0)).toBe(true)

    // 切页后每页条数正确
    const p2 = mockMqCheckPaged({ sortField: 'queueName', sortOrder: 'ascend', page: 2, limit: 2 })
    expect(p2.total).toBe(6)
    expect(p2.list).toHaveLength(2)
  })
})
