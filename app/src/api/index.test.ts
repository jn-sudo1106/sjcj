// @vitest-environment jsdom
// request() 内部的 mock 失败注入检查读 location.search，node 环境没有 location，必须切 jsdom。
import { describe, expect, it } from 'vitest'
import { ruleApi } from './index'

// 0805：恢复「选择已有规则」能力时按会议原话"新建是新建、选是选"分开做，只列当前登录账号自己的规则——
// orchestrationOwnRules 是 orchestrationPaged 的薄封装 + 客户端按 userCode 过滤，这里只测过滤这一层。
describe('ruleApi.orchestrationOwnRules（0805）', () => {
  it('只返回 userCode 等于当前登录账号（测试环境查不到登录态，回退 admin）的规则', async () => {
    const list = await ruleApi.orchestrationOwnRules()
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((r) => r.userCode === 'admin')).toBe(true)
  })
})
