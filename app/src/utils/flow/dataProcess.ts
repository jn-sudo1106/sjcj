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
  /** 规则处理节点：入参编码按 scriptParamName 去掉「-K列号」，与测试/执行传参一致。监控类节点不传（脚本按列查表）。 */
  scriptParamNames?: boolean
}

function selectFields(selected: string[], options: Pick<RuleFieldOption, 'itemCode' | 'itemName'>[]): DataProcessFieldOption[] {
  const byCode = new Map(options.map((item) => [item.itemCode, item]))
  const chosen = selected.length ? selected : options.map((item) => item.itemCode)
  return chosen.map((code) => byCode.get(code) ?? { itemCode: code, itemName: code })
}

function joinPairs(fields: DataProcessFieldOption[]): string {
  return fields.map((field) => `${field.itemName}:${field.itemCode}`).join(',')
}

/**
 * 规则脚本 `main` 的入参名：字段编码去掉旧平台的「-K列号」后缀（`INDICATOR-K1` → `INDICATOR`）。
 * 新建表的字段编码按旧约定存成「编码-列号」，带横杠不是合法的 Python 参数名；
 * 生成时告诉模型的入参名和测试/执行时传的参数名都必须走这一个函数，两边才对得上
 * （2026-11-17 186 实测：生成用 INDICATOR，测试传 INDICATOR-K1，执行端点报 unexpected keyword argument）。
 */
export function scriptParamName(itemCode: string): string {
  return itemCode.replace(/-K\d+$/, '')
}

export function buildDataProcessGeneratePayload(input: DataProcessGenerateInput): DataProcessGeneratePayload {
  const selectedInputs = selectFields(input.inputFields, input.inputFieldOptions)
  const inputFields = input.scriptParamNames
    ? selectedInputs.map((field) => ({ ...field, itemCode: scriptParamName(field.itemCode) }))
    : selectedInputs
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
