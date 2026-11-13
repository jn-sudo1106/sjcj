import { expect, it } from 'vitest'
import { loginRedirect } from './loginRedirect'

it('解开多层登录跳转，保留原业务查询参数', () => {
  expect(loginRedirect('/user/login?redirect=/user/login?redirect=/settings?tab=model-interfaces')).toBe('/settings?tab=model-interfaces')
  expect(loginRedirect('/user/login?redirect=' + encodeURIComponent('/data?table=1&page=2'))).toBe('/data?table=1&page=2')
  expect(loginRedirect('/settings?tab=model-interfaces')).toBe('/settings?tab=model-interfaces')
})
it.each([undefined, null, [], '/user/login', '/user/login?redirect=/user/login', '//example.com', 'https://example.com', '/\\example.com'])('无业务目标或非站内路径安全回总览：%s', value => {
  expect(loginRedirect(value)).toBe('/overview')
})
