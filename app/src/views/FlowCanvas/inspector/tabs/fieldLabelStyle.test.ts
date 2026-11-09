// @vitest-environment jsdom
// 1105 会议：右侧节点配置几个 Tab 的字段名「展示不明显」，要求向「参数配置」区块的层级看齐。
// 这四个 Tab 各自在 <style scoped> 里覆盖了同一份 .rc-field / .rc-field label 规则（全局 tokens.css 里的
// .rc-field 是筛选工具条的 chip 样式，会被这里覆盖），所以改样式必须四份一起改——这条契约测试就是防漏的。
import { describe, expect, it } from 'vitest'
import configTab from './ConfigTab.vue?raw'
import tableTab from './TableTab.vue?raw'
import taskTab from './TaskTab.vue?raw'
import ruleOrchestrationTab from './RuleOrchestrationTab.vue?raw'

const tabs = [
  ['节点配置 ConfigTab', configTab],
  ['表配置 TableTab', tableTab],
  ['任务配置 TaskTab', taskTab],
  ['编排配置 RuleOrchestrationTab', ruleOrchestrationTab],
] as const

/** 取某个单行选择器规则体的属性声明（忽略注释与换行差异） */
function declarations(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped} \\{([^}]*)\\}`))
  return (match?.[1] ?? '').replace(/\s+/g, ' ').trim()
}

describe('检查器 Tab 字段名（1105 会议：向「参数配置」看齐）', () => {
  it.each(tabs)('%s 的字段名用 12px / 600 / #334155，并拉开与控件的间距', (_name, source) => {
    const label = declarations(source, '.rc-field label')
    expect(label).toContain('font-size: 12px')
    expect(label).toContain('font-weight: 600')
    expect(label).toContain('color: #334155')
    expect(label).toContain('margin-bottom: 6px')
    // 旧的 11px 常规字重就是这个问题的根因，不许回退
    expect(label).not.toContain('11px')
    expect(label).not.toContain('var(--rc-muted)')
  })

  it.each(tabs)('%s 的字段行间距为 14px，说明文字仍比字段名轻', (_name, source) => {
    expect(declarations(source, '.rc-field')).toContain('margin-bottom: 14px')
    const help = declarations(source, '.rc-help')
    expect(help).toContain('font-size: 10px')
    expect(help).toContain('var(--rc-faint)')
  })
})