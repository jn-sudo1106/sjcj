import { describe, expect, it } from 'vitest'
import { endpointBackendTarget, flowRequestPath, isFlowWorkspace } from './flowBackend'

describe('本地流程分流范围', () => {
  const local = 'http://127.0.0.1:8090'
  const remote = 'http://118.25.96.217:9999'
  it.each(['flow/flowPaged', 'flow/flowTemplateList', 'flow/saveFlow', 'workflow/publish'])('流程端点 %s 在所有页面走本地', (endpoint) => {
    expect(flowRequestPath('/api/v1/' + endpoint, endpoint, local, '#/collect')).toBe('/api/local-flow/v1/' + endpoint)
  })
  it.each(['item/next/stepModify', 'config/configDetail', 'config/modify/updateConfig', 'config/add'])('流程画布的 %s 走本地', (endpoint) => {
    expect(flowRequestPath('/api/v1/' + endpoint, endpoint, local, '#/canvas?view=flow&sourceId=1')).toBe('/api/local-flow/v1/' + endpoint)
    expect(endpointBackendTarget(endpoint, remote, local, '#/flows')).toBe(local)
  })
  it.each(['#/data', '#/rules', '#/canvas?view=data', '#/canvas?view=source'])('非流程区域 %s 的配置和步骤请求保持原后台', (hash) => {
    for (const endpoint of ['config/configDetail', 'item/next/nextConfigPaged']) {
      expect(flowRequestPath('/api/v1/' + endpoint, endpoint, local, hash)).toBe('/api/v1/' + endpoint)
    }
  })
  it.each(['site/sources', 'source/sourceDetail', 'entry/entryDataPaged', 'task/topTaskPaged', 'param/paramPaged'])('%s 在流程画布仍走原后台', (endpoint) => {
    expect(flowRequestPath('/api/v1/' + endpoint, endpoint, local, '#/canvas?view=flow')).toBe('/api/v1/' + endpoint)
    expect(endpointBackendTarget(endpoint, remote, local, '#/canvas?view=flow')).toBe(remote)
  })
  it('未设置本地流程目标时维持原行为，不接管独立服务或自定义 API_BASE', () => {
    expect(flowRequestPath('/api/v1/workflow/publish', 'workflow/publish', undefined, '#/flows')).toBe('/api/v1/workflow/publish')
    expect(flowRequestPath('/vrule/execute', '/vrule/execute', local, '#/flows')).toBe('/vrule/execute')
    expect(flowRequestPath('https://example.com/api/flow/saveFlow', 'flow/saveFlow', local, '#/flows')).toBe('https://example.com/api/flow/saveFlow')
    expect(isFlowWorkspace('#/canvas?view=data&other=flow')).toBe(false)
  })
})
