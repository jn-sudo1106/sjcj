import { describe, expect, it } from 'vitest'
import { parseTaskResult } from './taskResult'

describe('parseTaskResult', () => {
  it.each([
    // 186 实测的执行端契约
    ['{"IsSuccess":"false","StrTaskId":"912795","ErrorMessage":""}', 'failed', ''],
    ['{"IsSuccess": "true", "StrTaskId": "1255968", "ErrorMessage": "-"}', 'success', ''],
    ['{"IsSuccess":true,"Params":"{\\"uid\\":\\"ABCD\\"}","StrTaskId":"917452"}', 'success', ''],
    ['{"IsSuccess":"false","StrTaskId":"1","ErrorMessage":"页面超时"}', 'failed', '页面超时'],
    ['{"IsSuccess":false,"StrTaskId":"1","ErrorMessage":"-"}', 'failed', ''],
    // 兼容形态
    ['{"status":"fail","error":"timeout"}', 'failed', 'timeout'],
    ['{"status":"error","message":"连接被拒绝"}', 'failed', '连接被拒绝'],
    ['{"error":"目标站点 502"}', 'failed', '目标站点 502'],
    ['{"status":"success","message":"ok"}', 'success', ''],
    ['{"success":true}', 'success', ''],
    ['{"success":false,"msg":"无数据"}', 'failed', '无数据'],
    ['{"code":0,"msg":"成功"}', 'success', ''],
    ['{"code":500,"msg":"服务异常"}', 'failed', '服务异常'],
    ['{"count":120,"success":120}', 'success', ''],
    ['{"skipped":true}', 'unknown', ''],
    ['[{"status":"fail","error":"第一条"},{"status":"success"}]', 'failed', '第一条'],
    ['{"status":"fail","error":{"message":"嵌套错误"}}', 'failed', '嵌套错误'],
    ['success', 'success', ''],
    ['Traceback (most recent call last): KeyError', 'failed', 'Traceback (most recent call last): KeyError'],
    ['某段说明', 'unknown', '某段说明'],
    ['{}', 'unknown', ''],
  ] as const)('%s → %s', (raw, status, message) => {
    expect(parseTaskResult(raw)).toMatchObject({ status, message, raw })
  })

  it('空值与空白不猜成功', () => {
    expect(parseTaskResult(undefined)).toEqual({ status: 'unknown', message: '', raw: '' })
    expect(parseTaskResult('   ')).toEqual({ status: 'unknown', message: '', raw: '' })
  })
})
