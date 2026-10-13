import { describe, expect, it } from 'vitest'
import { buildTaskQuery, TIME_INVALID_MSG, type TaskRowQuery } from './taskList'

// 任务实例分页的入参口径（旧 data-view `src/api/task.js` 的 FIELDS 白名单 + 时间预校验）。
// 这一层守的是「哪些键会发给后端」和「非法时间不发请求」，字段多一个少一个都会打到真实后端。
describe('taskList · 分页入参口径（对齐旧 api/task.js）', () => {
  it('空串 / 纯空白视为未传；page/limit 有默认值', () => {
    const params = buildTaskQuery({ taskId: '  ', state: '', sourceId: '   ' })
    expect(params).toEqual({ page: 1, limit: 20 })
  })

  it('只下发后端支持的 15 个白名单键（title 之类的历史遗留键一律不传）', () => {
    const q = {
      taskId: '8348509120',
      state: 'C',
      sourceId: '161725',
      sourceIds: '161725,161801',
      taskUrl: '/list',
      siteId: '11',
      groupId: '22',
      configId: '70598',
      parentId: '9',
      taskSpecId: '2001',
      fileId: 'F-7781',
      taskTopic: 'queue_70598',
      startTime: '2026-10-01',
      endTime: '2026-10-13',
      all: '1',
      page: 3,
      limit: 30,
      // 下面两个都不在白名单里
      title: '标题',
      sourceUrl: 'http://x',
    } as TaskRowQuery
    const params = buildTaskQuery(q)
    expect(Object.keys(params).sort()).toEqual([
      'all', 'configId', 'endTime', 'fileId', 'groupId', 'limit', 'page', 'parentId',
      'siteId', 'sourceId', 'sourceIds', 'startTime', 'state', 'taskId', 'taskSpecId',
      'taskTopic', 'taskUrl',
    ])
    expect(params).not.toHaveProperty('title')
    expect(params).not.toHaveProperty('sourceUrl')
    expect(params.page).toBe(3)
    expect(params.limit).toBe(30)
  })

  it('时间支持 yyyy-MM-dd 与 yyyy-MM-dd HH:mm:ss；非法格式直接抛错（不发请求）', () => {
    expect(() => buildTaskQuery({ startTime: '2026/10/01' })).toThrow(TIME_INVALID_MSG)
    expect(() => buildTaskQuery({ endTime: '2026-10-13 08:00' })).toThrow(TIME_INVALID_MSG)
    // 合法：纯日期
    expect(buildTaskQuery({ startTime: '2026-10-01', endTime: '2026-10-13' })).toMatchObject({
      startTime: '2026-10-01', endTime: '2026-10-13',
    })
    // 合法：带时分秒
    expect(buildTaskQuery({ startTime: '2026-10-01 00:00:00', endTime: '2026-10-13 23:59:59' })).toMatchObject({
      startTime: '2026-10-01 00:00:00', endTime: '2026-10-13 23:59:59',
    })
  })

  it('结束时间早于开始时间直接拒绝（与后端 code=1 同口径）', () => {
    expect(() => buildTaskQuery({ startTime: '2026-10-13', endTime: '2026-10-01' })).toThrow(TIME_INVALID_MSG)
    // 同一天（纯日期）算合法：start 00:00:00、end 23:59:59
    expect(() => buildTaskQuery({ startTime: '2026-10-13', endTime: '2026-10-13' })).not.toThrow()
  })
})
