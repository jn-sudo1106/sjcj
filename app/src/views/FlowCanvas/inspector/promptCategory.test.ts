import { describe, expect, it } from 'vitest'
import { cloneConfig, NODE_CONFIGS } from '@/views/FlowCanvas/canvas/flowModel'
import {
  defaultPromptCategoryForNode,
  promptCategoryGroupsForNode,
  resolvePromptCategoryForNode,
} from './promptCategory'

function labels(nodeKey: keyof typeof NODE_CONFIGS) {
  return promptCategoryGroupsForNode(cloneConfig(NODE_CONFIGS[nodeKey])).flatMap((group) => group.options.map((item) => item.value))
}

describe('promptCategory helpers', () => {
  it('采集节点按能力给出对应分类', () => {
    expect(labels('web-list')).toEqual(['网页抓取', 'APP抓取', '文件下载', 'Python抓取', '浏览器抓取', '公众号抓取', '网页登录'])
    expect(defaultPromptCategoryForNode(cloneConfig(NODE_CONFIGS['browser-html-collect']))).toBe('浏览器抓取')
    expect(defaultPromptCategoryForNode(cloneConfig(NODE_CONFIGS['wechat-html-collect']))).toBe('公众号抓取')
    expect(defaultPromptCategoryForNode(cloneConfig(NODE_CONFIGS['login-collect']))).toBe('网页登录')
  })

  it('逻辑、规则、引用、通知节点各自返回对应分类', () => {
    expect(labels('decision')).toEqual(['决策分支'])
    expect(labels('parallel')).toEqual(['分头处理'])
    expect(labels('rule')).toEqual(['规则处理'])
    expect(labels('metric')).toEqual(['指标引用'])
    expect(labels('mail')).toEqual(['提取数据发邮件', '异常告警'])
  })

  it('数据处理与其他节点返回对应分类', () => {
    expect(labels('process')).toEqual(['数据处理'])
    expect(labels('custom')).toEqual(['自定义节点'])
  })

  it('默认值与回退值按当前节点约束收敛', () => {
    const rule = cloneConfig(NODE_CONFIGS['rule'])
    expect(defaultPromptCategoryForNode(rule)).toBe('规则处理')
    expect(resolvePromptCategoryForNode(rule, '规则处理')).toBe('规则处理')
    expect(resolvePromptCategoryForNode(rule, '网页抓取')).toBe('规则处理')
  })
})
