import { describe, expect, it } from 'vitest'
import { isSessionExpiredRedirect } from './auth'

describe('旧后台会话失效重定向', () => {
  it.each([
    'http://localhost:5173/apiapi/logout.htm',
    'http://localhost:5173/loginProxy.htm;jsessionid=test',
  ])('识别登录失效地址 %s', url => {
    expect(isSessionExpiredRedirect({ redirected: true, url } as Response)).toBe(true)
  })

  it('普通业务重定向和直接登录页访问不会误报', () => {
    expect(isSessionExpiredRedirect({ redirected: true, url: 'http://localhost:5173/api/v1/flow/detail' } as Response)).toBe(false)
    expect(isSessionExpiredRedirect({ redirected: false, url: 'http://localhost:5173/loginProxy.htm' } as Response)).toBe(false)
  })
})
