import type { RuleFieldOption } from '@/api'

export interface DataProcessGeneratePayload {
  description: string
  configId: number
  providerCode: string
  model: string
  sourceTable: string
  targetTable: string
  inputFields: string
  outputFields: string
  systemPrompt: string
  /** 数据监控方法拼接（逗号分隔），仅 monitor 节点传入 */
  checkRule?: string
}

export interface DataProcessFieldOption {
  itemCode: string
  itemName: string
}

export interface DataProcessGenerateInput {
  description: string
  configId: number
  providerCode: string
  model: string
  sourceTable: string
  targetTable: string
  inputFields: string[]
  outputFields: string[]
  inputFieldOptions: Pick<RuleFieldOption, 'itemCode' | 'itemName'>[]
  outputFieldOptions: Pick<RuleFieldOption, 'itemCode' | 'itemName'>[]
  /** 系统提示词：取自规则脚本工作区「系统提示词」文本框（RuleWorkbenchDialog 左栏草稿 → orchCfg.systemPrompt） */
  systemPrompt: string
  /** 数据监控方法拼接（逗号分隔），仅 monitor 节点传入 */
  checkRule?: string
}

function selectFields(selected: string[], options: Pick<RuleFieldOption, 'itemCode' | 'itemName'>[]): DataProcessFieldOption[] {
  const byCode = new Map(options.map((item) => [item.itemCode, item]))
  const chosen = selected.length ? selected : options.map((item) => item.itemCode)
  return chosen.map((code) => byCode.get(code) ?? { itemCode: code, itemName: code })
}

function joinPairs(fields: DataProcessFieldOption[]): string {
  return fields.map((field) => `${field.itemName}:${field.itemCode}`).join(',')
}

export function buildDataProcessGeneratePayload(input: DataProcessGenerateInput): DataProcessGeneratePayload {
  const inputFields = selectFields(input.inputFields, input.inputFieldOptions)
  const outputFields = selectFields(input.outputFields, input.outputFieldOptions.length ? input.outputFieldOptions : input.inputFieldOptions)
  return {
    description: input.description,
    configId: input.configId,
    providerCode: input.providerCode,
    model: input.model,
    sourceTable: input.sourceTable,
    targetTable: input.targetTable,
    inputFields: joinPairs(inputFields),
    outputFields: joinPairs(outputFields),
    systemPrompt: input.systemPrompt,
    checkRule: input.checkRule,
  }
}

/**
 * PDF 抓取节点「解析内容」（1005 方案 §5.3）：样本 PDF 交后端抽正文，按当前提示词产出抽取结果。
 * 与生成脚本的 payload 差异是没有 sourceTable/checkRule，且 systemPrompt 必填——
 * 这条链路只做"读文档 + 按提示词输出"，不产出脚本、不落库。
 */
export interface DocumentExtractPayload {
  description: string
  systemPrompt: string
  configId: number
  providerCode: string
  model: string
  outputFields: string
  outputFormat: 'text' | 'json'
}

export interface DocumentExtractInput {
  description: string
  systemPrompt: string
  configId: number
  providerCode: string
  model: string
  outputFields: string[]
  outputFieldOptions: Pick<RuleFieldOption, 'itemCode' | 'itemName'>[]
  /** 一期固定 text（自由文本/markdown），json 留给二期的字段对齐 */
  outputFormat?: 'text' | 'json'
}

export function buildDocumentExtractPayload(input: DocumentExtractInput): DocumentExtractPayload {
  return {
    description: input.description,
    systemPrompt: input.systemPrompt,
    configId: input.configId,
    providerCode: input.providerCode,
    model: input.model,
    outputFields: joinPairs(selectFields(input.outputFields, input.outputFieldOptions)),
    outputFormat: input.outputFormat ?? 'text',
  }
}
