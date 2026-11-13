import { expect, it } from 'vitest'
import { parseProxyCurl } from './proxyCurlImport'

it('解析域名代理和 -U 认证，保留密码中的冒号及空格，忽略目标网址', () => {
  expect(parseProxyCurl('curl -x proxy.example.com:31100 -U "customer-test:secret:with space" cip.cc')).toEqual({
    ip: 'proxy.example.com', port: 31100, account: 'customer-test', password: 'secret:with space',
  })
})
it('支持长参数、curl.exe 续行、显式 80 端口和 URL 编码认证', () => {
  expect(parseProxyCurl('curl.exe ^\n --proxy=http://proxy.example.com:80 --proxy-user="user:pass" https://example.com')).toEqual({ ip: 'proxy.example.com', port: 80, account: 'user', password: 'pass' })
  expect(parseProxyCurl("curl -x 'http://u:p%40ss@127.0.0.1:8080' example.com").password).toBe('p@ss')
})
it('缺少认证时不继承旧密码，认证参数不误当作普通 -u 用户参数', () => {
  expect(parseProxyCurl('curl -xproxy.example.com:8080 -u target:credentials example.com')).toEqual({ ip: 'proxy.example.com', port: 8080, account: '', password: '' })
})
it.each(['curl example.com', 'curl -x host:99999 example.com', 'curl -x host:8080 -U user example.com', 'curl -x socks5://host:1080 example.com', 'curl -x host:8080; curl other.com', 'curl -x host:8080 -U "unclosed', 'curl -x'])('无效配置拒绝导入，错误不回显认证内容', text => {
  expect(() => parseProxyCurl(text)).toThrow()
})
