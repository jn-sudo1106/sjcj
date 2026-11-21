// 数据监控提示词模板（1117 会议 / 前端修改清单 1.1、1.2）。
//
// 会上定：AI 监控的提示词拆成「系统提示词 + 用户提示词」两段，配在「系统设置 → 节点提示词模板」的
// 数据监控类型（节点类型 610）里；新建监控时自动读取，并按表单选项填充变量。
// 这里只负责「取模板 + 填变量」，取不到模板时由调用方退回内置默认（utils/monitor/methods），不阻断生成。
//
// 模板接口走 Runner 管理服务（/api/runner-management/node-prompt-templates）。
import { defaultNodePrompt, fillNodePrompt, nodePromptApi, type NodePromptTemplate } from '@/api/nodePrompts'
import { defaultDescription, methodLabel } from '@/utils/monitor/methods'

/** 数据监控节点类型（cfg_source_type，flowModel.seeds.ts「[610] - 数据监控」） */
export const MONITOR_SOURCE_TYPE = '610'

export interface MonitorPromptInput {
  sourceId?: string
  sourceName?: string
  tableName?: string
  timeColumn?: string
  methods?: string[]
  window?: string
  nullPolicy?: string
  noDataPolicy?: string
}

/** 模板里可用的变量（{{name}}），提示给模板维护人 */
export const MONITOR_PROMPT_VARIABLES = [
  ['source_id', '被监控源 ID'],
  ['source_name', '被监控源名称'],
  ['table_name', '检查的物理表名'],
  ['time_column', '入库时间字段'],
  ['methods', '勾选的检查方法（中文名，顿号分隔）'],
  ['window', '检查时间窗口口径'],
  ['describe', '按表单生成的内置业务描述'],
] as const

/**
 * 取启用中的默认模板；没有默认取第一个启用的。
 * 接口失败或没配置都返回 null——调用方退回内置提示词，并把 error 透给界面提示。
 */
export async function loadMonitorPromptTemplate(): Promise<{ template: NodePromptTemplate | null; error: string }> {
  try {
    const rows = await nodePromptApi.list({ sourceType: MONITOR_SOURCE_TYPE, templateUse: 'script' })
    return { template: defaultNodePrompt(rows ?? []) ?? null, error: '' }
  } catch (error) {
    return { template: null, error: error instanceof Error ? error.message : String(error) }
  }
}

export function monitorPromptVariables(input: MonitorPromptInput): Record<string, string> {
  const methods = input.methods ?? []
  return {
    source_id: input.sourceId ?? '',
    source_name: input.sourceName ?? '',
    table_name: input.tableName ?? '',
    time_column: input.timeColumn ?? '',
    methods: methods.map(methodLabel).filter(Boolean).join('、'),
    window: input.window ?? '',
    describe: defaultDescription({
      sourceName: input.sourceName,
      tableName: input.tableName,
      methods,
      window: input.window,
      nullPolicy: input.nullPolicy,
      noDataPolicy: input.noDataPolicy,
    }),
  }
}

/** 系统提示词：模板有就用模板，没有返回 null（调用方保留内置默认） */
export function templateSystemPrompt(template: NodePromptTemplate | null, input: MonitorPromptInput): string | null {
  const text = template?.systemPrompt?.trim()
  return text ? fillNodePrompt(text, monitorPromptVariables(input)) : null
}

/**
 * 用户提示词（= 编辑器里的「业务描述」，生成时作为 description 发给模型）：
 * 模板配了用户提示词就按模板填，否则用内置的 defaultDescription。
 */
export function monitorUserPrompt(template: NodePromptTemplate | null, input: MonitorPromptInput): string {
  const variables = monitorPromptVariables(input)
  const text = template?.userPromptTemplate?.trim()
  return text ? fillNodePrompt(text, variables) : variables.describe
}
