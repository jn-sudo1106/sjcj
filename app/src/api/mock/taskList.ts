// 任务实例（/v1/task/topTaskPaged）mock —— 只服务于「任务实例页」这个逻辑名 `task/taskListPaged`。
//
// 为什么另起一份而不复用 mock/sources.ts 的 mockSourceTasks：那一份返回的是**平台归一化后的**
// TaskInst（typeName / node / topic / updatedAt），而任务实例页要 1:1 渲染旧 column.config 的
// 原始字段名（actionName / nodeCode / taskTopic / updateDt），两者对不上。
// 真实后端返回的就是原始字段名，所以这里按原始字段名造数据，和线上形态一致。
//
// 筛选口径按后端 topTaskPaged 的 15 个白名单键实现，让页面上每个搜索项都能看到效果。
import type { TaskPage, TaskRow } from '../taskList'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const shift = (minutes: number) => stamp(new Date(Date.now() + minutes * 60_000))

/** 展示类任务规格（后端 all=1 时不过滤；1001/1002/1007 为展示类） */
const DISPLAY_SPECS = new Set(['1001', '1002', '1007'])

const TASK_ROWS: TaskRow[] = [
  {
    taskId: '8348509120', state: 'C', taskSpecId: '2001', actionName: '浏览器抓取',
    taskName: '首页列表抓取', sourceId: '161725', configId: '70598',
    updateDt: shift(-6), nodeCode: 'dev_web_snatch_zfb', taskTopic: 'queue_70598', parentId: '',
    flowId: '9001', bizId: '', domain: 'www.demo.com', typeId: '11', ptaskId: '',
    needLogin: '0', fileId: '', createDt: shift(-8), startDt: shift(-7), endDt: shift(-6),
    params: '{"url":"https://www.demo.com/list"}',
    taskResult: '{"count":120,"success":120}',
    vars: '{"page":1}',
    taskUrl: 'https://www.demo.com/list',
  },
  {
    taskId: '8348509131', state: 'L', taskSpecId: '2001', actionName: '浏览器抓取',
    taskName: '详情页抓取', sourceId: '161725', configId: '70598',
    updateDt: shift(-2), nodeCode: 'dev_web_snatch_zfb', taskTopic: 'queue_70598', parentId: '',
    flowId: '9001', bizId: '', domain: 'www.demo.com', typeId: '11', ptaskId: '',
    needLogin: '0', fileId: '', createDt: shift(-3), startDt: shift(-2), endDt: '',
    params: '{"url":"https://www.demo.com/detail/1024"}',
    taskResult: '', vars: '', taskUrl: 'https://www.demo.com/detail/1024',
  },
  {
    taskId: '8348509140', state: 'E', taskSpecId: '2003', actionName: '接口采集',
    taskName: '行情接口拉取', sourceId: '161801', configId: '70611',
    updateDt: shift(-35), nodeCode: 'dev_api_fetch', taskTopic: 'api_70611', parentId: '',
    flowId: '9002', bizId: '', domain: 'api.demo.com', typeId: '22', ptaskId: '',
    needLogin: '1', fileId: '', createDt: shift(-36), startDt: shift(-36), endDt: shift(-35),
    params: '{"path":"/quote/list","pageSize":50}',
    taskResult: '{"error":"目标站点 502"}', vars: '',
    taskUrl: 'https://api.demo.com/quote/list',
  },
  {
    taskId: '8348509152', state: 'AC', taskSpecId: '2001', actionName: '浏览器抓取',
    taskName: '重复页跳过', sourceId: '161801', configId: '70611',
    updateDt: shift(-90), nodeCode: 'dev_web_snatch', taskTopic: 'api_70611', parentId: '8348509140',
    flowId: '9002', bizId: '1024', domain: 'api.demo.com', typeId: '11', ptaskId: '8348509140',
    needLogin: '0', fileId: 'F-7781', createDt: shift(-91), startDt: shift(-91), endDt: shift(-90),
    params: '{}', taskResult: '{"skipped":true}', vars: '', taskUrl: 'https://api.demo.com/quote/1',
  },
  {
    taskId: '8348509160', state: 'W1', taskSpecId: '3001', actionName: '数据清洗',
    taskName: '入表前字段校验', sourceId: '161900', configId: '70812',
    updateDt: shift(-1), nodeCode: 'dev_clean', taskTopic: 'clean_70812', parentId: '',
    flowId: '9003', bizId: '', domain: 'clean.demo.com', typeId: '33', ptaskId: '',
    needLogin: '0', fileId: '', createDt: shift(-1), startDt: '', endDt: '',
    params: '{"tableId":"1042"}', taskResult: '', vars: '{}', taskUrl: '',
  },
  {
    taskId: '8348509175', state: 'W', taskSpecId: '1001', actionName: '展示类统计',
    taskName: '展示类任务-统计', sourceId: '161900', configId: '70833',
    updateDt: shift(-240), nodeCode: 'dev_stat', taskTopic: 'stat_70833', parentId: '',
    flowId: '9003', bizId: '', domain: 'stat.demo.com', typeId: '44', ptaskId: '',
    needLogin: '0', fileId: '', createDt: shift(-241), startDt: '', endDt: '',
    params: '{}', taskResult: '{}', vars: '', taskUrl: '',
  },
  {
    taskId: '8348509188', state: 'C', taskSpecId: '1002', actionName: '展示类统计',
    taskName: '展示类任务-汇总', sourceId: '161901', configId: '70833',
    updateDt: shift(-600), nodeCode: 'dev_stat', taskTopic: 'stat_70833', parentId: '',
    flowId: '9003', bizId: '', domain: 'stat.demo.com', typeId: '44', ptaskId: '',
    needLogin: '0', fileId: '', createDt: shift(-601), startDt: shift(-600), endDt: shift(-600),
    params: '{}', taskResult: '{"rows":88}', vars: '', taskUrl: '',
  },
]

/** 任务实例分页：字段与后端一致，筛选按 topTaskPaged 的 15 个白名单键。 */
export function mockTaskListPaged(params?: Record<string, unknown>): TaskPage {
  const text = (key: string) => String(params?.[key] ?? '').trim()
  const taskId = text('taskId')
  const state = text('state')
  const sourceId = text('sourceId')
  const sourceIds = text('sourceIds')
  const taskUrl = text('taskUrl')
  const configId = text('configId')
  const parentId = text('parentId')
  const taskSpecId = text('taskSpecId')
  const fileId = text('fileId')
  const taskTopic = text('taskTopic')
  const startTime = text('startTime')
  const endTime = text('endTime')
  const all = text('all')
  // 旧页把「网站ID / 分组ID」也发下来；mock 里没有对应列，但为了不出现"填了没反应"的假象，
  // 用一个稳定的伪映射让它们参与过滤（网站ID → sourceId 前缀，分组ID → flowId 前缀）。
  const siteId = text('siteId')
  const groupId = text('groupId')

  const matched = TASK_ROWS.filter((row) => {
    if (taskId && !row.taskId.includes(taskId)) return false
    if (state && row.state !== state) return false
    if (sourceId && !String(row.sourceId ?? '').includes(sourceId)) return false
    if (sourceIds && !sourceIds.split(',').some((id) => String(row.sourceId ?? '') === id.trim())) return false
    if (taskUrl && !String(row.taskUrl ?? '').includes(taskUrl)) return false
    if (configId && !String(row.configId ?? '').includes(configId)) return false
    if (parentId && String(row.parentId ?? '') !== parentId) return false
    if (taskSpecId && !String(row.taskSpecId ?? '').includes(taskSpecId)) return false
    if (fileId && String(row.fileId ?? '') !== fileId) return false
    if (taskTopic && !String(row.taskTopic ?? '').includes(taskTopic)) return false
    if (siteId && !String(row.sourceId ?? '').startsWith(siteId.slice(0, 3))) return false
    if (groupId && !String(row.flowId ?? '').startsWith(groupId.slice(0, 2))) return false
    // 创建时间范围按 createDt 的日期部分比较（旧页 startTime/endTime 就是日期）
    const created = String(row.createDt ?? '').slice(0, 10)
    if (startTime && created < startTime.slice(0, 10)) return false
    if (endTime && created > endTime.slice(0, 10)) return false
    // all !== '1' → 排除展示类任务规格（1001/1002/1007）
    if (all !== '1' && DISPLAY_SPECS.has(String(row.taskSpecId ?? ''))) return false
    return true
  })

  const page = Math.max(1, Number(params?.page ?? 1) || 1)
  const limit = Math.max(1, Number(params?.limit ?? 20) || 20)
  return { total: matched.length, list: matched.slice((page - 1) * limit, page * limit) }
}
