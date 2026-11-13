// 保存定时失败的人话提示（2026-10-12）
import { describe, expect, it } from 'vitest'
import { cronSaveErrorHint, unpublishedFlowCronHint } from './cronSaveHint'

describe('cronSaveHint', () => {
  it('未发布的流程：说明先发布，带草稿版本号', () => {
    expect(unpublishedFlowCronHint('21000012', 1)).toContain('点画布上方的「发布 v1」')
    expect(unpublishedFlowCronHint('21000012', 1)).toContain('#21000012')
    expect(unpublishedFlowCronHint('21000012')).toContain('发布这条流程')
  })
  it('后端「无法按所选流程调度 / ROOT缺失 / 没有有效发布版本」翻成人话；别的报错返回 null 原样展示', () => {
    for (const raw of [
      '请求异常 [source/createJobs]: 以下源无法按所选流程调度（未关联或ROOT缺失），未创建任何调度：430024674',
      '没有有效发布版本，flowId=21000014',
      'ROOT未配置有效入口配置，flowId=21000014',
    ]) expect(cronSaveErrorHint(raw)).toContain('请先把流程的起始节点配好并发布')
    expect(cronSaveErrorHint('cron 表达式不合法')).toBeNull()
  })
})
