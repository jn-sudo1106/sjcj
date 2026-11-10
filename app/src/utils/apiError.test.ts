import { describe, expect, it } from 'vitest'
import { isLockConflictError, readableApiError } from './apiError'

/** 1109 线上真实返回：后端把 MyBatis/JPA 诊断整段拼进 message */
const LOCK_MESSAGE = '请求异常 [source-group/bindSourceFlows]: 操作冲突：流程正在被其他人操作，请稍后重试：'
  + ' ### Error querying database. Cause: com.mysql.cj.jdbc.exceptions.MySQLTransactionRollbackException:'
  + ' Lock wait timeout exceeded; try restarting transaction'
  + ' ### The error may exist in com/vanvbee/dao/mapper/CsFlowMapper.java (best guess)'
  + ' ### The error may involve com.vanvbee.dao.mapper.CsFlowMapper.lockById-Inline'
  + ' ### SQL: SELECT FLOW_ID FROM cs_flow WHERE FLOW_ID = ? FOR UPDATE NOWAIT'
  + ' ### Cause: com.mysql.cj.jdbc.exceptions.MySQLTransactionRollbackException: Lock wait timeout exceeded'
  + '; nested exception is org.springframework.dao.PessimisticLockingFailureException: Lock wait timeout exceeded'

describe('readableApiError', () => {
  it('去掉端点前缀，只留后端给的可读原因', () => {
    expect(readableApiError(new Error('请求异常 [source-view/add]: 请求失败 500: 视图名称已存在'))).toBe('视图名称已存在')
    expect(readableApiError(new Error('错误信息:运行时异常: 参数不合法'))).toBe('参数不合法')
  })

  it('截掉 JPA 诊断段，SQL/mapper 细节不外泄，锁冲突转成可重试的提示', () => {
    const text = readableApiError(new Error(LOCK_MESSAGE))
    expect(text).toBe('流程正被并发操作占用（锁等待超时），请稍后重试')
    expect(isLockConflictError(new Error(LOCK_MESSAGE))).toBe(true)
  })

  it('残留实现细节时退回兜底文案', () => {
    expect(readableApiError(new Error('请求异常 [x]: com.vanvbee.dao.mapper.CsFlowMapper.lockById-Inline'))).toBe('操作失败，请稍后重试')
    expect(readableApiError(new Error('SELECT 1 FOR UPDATE NOWAIT'), '保存失败')).toBe('保存失败')
  })

  it('业务文案原样保留，空消息用兜底，超长截断', () => {
    expect(readableApiError(new Error('属于来源组 #88，请到来源组配置流程'))).toBe('属于来源组 #88，请到来源组配置流程')
    expect(readableApiError(new Error('   '))).toBe('操作失败，请稍后重试')
    expect(readableApiError(undefined)).toBe('操作失败，请稍后重试')
    const long = readableApiError(new Error('原'.repeat(200)))
    expect(long).toHaveLength(161)
    expect(long.endsWith('…')).toBe(true)
  })

  it('普通失败不当作锁冲突', () => {
    expect(isLockConflictError(new Error('网络连接失败'))).toBe(false)
  })
})