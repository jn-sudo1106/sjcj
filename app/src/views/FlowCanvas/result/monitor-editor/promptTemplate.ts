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
  overdue?: string
  generationMode?: 'agent' | 'builtin'
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
export async function loadMonitorPromptTemplate(): Promise<{ template: NodePromptTemplate | null; templates: NodePromptTemplate[]; error: string }> {
  try {
    const rows = await nodePromptApi.list({ sourceType: MONITOR_SOURCE_TYPE, templateUse: 'script' })
    const templates = (rows ?? []).filter((row) => row.isActive === 1)
    return { template: defaultNodePrompt(templates) ?? null, templates, error: '' }
  } catch (error) {
    return { template: null, templates: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export function monitorPromptVariables(input: MonitorPromptInput): Record<string, string> {
  const methods = input.methods ?? []
  const describe = defaultDescription({
    sourceName: input.sourceName,
    tableName: input.tableName,
    methods,
    window: input.window,
    nullPolicy: input.nullPolicy,
    noDataPolicy: input.noDataPolicy,
  })
  return {
    source_id: input.sourceId ?? '',
    source_name: input.sourceName ?? '',
    table_name: input.tableName ?? '',
    time_column: input.timeColumn ?? '',
    methods: methods.map(methodLabel).filter(Boolean).join('、'),
    window: input.window ?? '',
    describe: [describe, input.overdue].filter(Boolean).join('\n'),
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
  return text ? prepareMonitorUserPrompt(fillNodePrompt(text, variables), input.generationMode) : variables.describe
}

// Agent generation injects the actual machine workspace separately. Keep the editor and the
// model-facing description free of unresolved paths, including templates without the standard section.
export function prepareMonitorUserPrompt(text: string, mode: MonitorPromptInput['generationMode']): string {
  if (!mode) return text
  const storage = /^((?:[一二三四五六七八九十]+、保存位置|【保存位置】)[：:]*[^\S\n]*)\n[\s\S]*?(?=^(?:[一二三四五六七八九十]+、|【)|$(?![\s\S]))/m
  const paths = /\{\{\s*(?:file_name|code_dir|code_file_path|code_save_requirement|reference_files)\s*\}\}/g
  return text.replace(storage, (block, heading: string) => {
    if (mode === 'builtin') return ''
    if (!block.match(paths)) return block
    return `${heading}\n\n脚本按「<源ID>/<监控ID>.py」归档，工作目录由生成时的平台配置提供。\n\n`
  }).replace(paths, mode === 'agent' ? '生成时由平台自动填入' : '由接口返回完整脚本').trim()
}
