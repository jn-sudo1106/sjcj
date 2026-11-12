import type { RuleFieldOption } from '@/api'

export interface PromptTemplateContext {
  inputTableName: string
  outputTableName: string
  sourceId?: string
  sourceCron?: string
  inputFields: string[]
  outputFields: string[]
  inputFieldOptions: RuleFieldOption[]
  outputFieldOptions: RuleFieldOption[]
  /** 模型供应商下拉值（编排 Tab / 工作区的 modelProviderCode），填 `{{provider_code}}` */
  providerCode?: string
  /** 模型下拉值，填 `{{model}}` */
  model?: string
  /** 「设置业务规则」描述文本框的值，填 `{{describe}}` */
  describe?: string
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceToken(text: string, key: string, value: string): string {
  const bracePattern = new RegExp(escapeRegExp(`{{${key}}}`), 'g')
  const barePattern = new RegExp(`\\b${escapeRegExp(key)}\\b(?!\\s*=)`, 'g')
  return text.replace(bracePattern, value).replace(barePattern, value)
}

/**
 * 只替换 `{{key}}`，不做裸词替换：模型供应商 / 模型 / 描述这三项的值本身是提示词正文里的
 * 常见词（PDF 模板里就有 `model为{{model}}` 这种说明行），按裸词替换会把散文一起改掉。
 */
function replaceBraceToken(text: string, key: string, value: string): string {
  // 值走函数形式：描述是用户手打的正文，`$&` 这类串直接当替换串会被特殊字符语义吃掉
  return text.replace(new RegExp(escapeRegExp(`{{${key}}}`), 'g'), () => value)
}

function selectFields(selected: string[], options: RuleFieldOption[]): RuleFieldOption[] {
  if (!selected.length) return options
  const byCode = new Map(options.map((item) => [item.itemCode, item]))
  return selected.map((code) => byCode.get(code)).filter((item): item is RuleFieldOption => !!item)
}

function joinPairs(fields: RuleFieldOption[]): string {
  return fields.map((field) => `${field.itemName}:${field.itemCode}`).join(',')
}

function joinCodes(fields: RuleFieldOption[]): string {
  return fields.map((field) => field.itemCode).join(',')
}

export function applyPromptTemplate(template: string, context: PromptTemplateContext): string {
  const inputFields = selectFields(context.inputFields, context.inputFieldOptions)
  const outputFields = selectFields(context.outputFields, context.outputFieldOptions)
  const text = [
    ['source_id', context.sourceId ?? ''],
    ['source_cron', context.sourceCron ?? ''],
    ['source_table', context.inputTableName],
    ['target_table', context.outputTableName],
    ['input_table', context.inputTableName],
    ['output_table', context.outputTableName],
    ['input_pair', joinPairs(inputFields)],
    ['output_pair', joinPairs(outputFields)],
    ['input_fields', joinCodes(inputFields)],
    ['output_fields', joinCodes(outputFields)],
  ].reduce((prompt, [key, value]) => replaceToken(prompt, key, value), template)
  // PDF 抓取模板（prompt_id=6）里的三个变量：放在表/字段替换之后，只认花括号写法
  return [
    ['provider_code', context.providerCode ?? ''],
    ['model', context.model ?? ''],
    ['describe', context.describe ?? ''],
  ].reduce((prompt, [key, value]) => replaceBraceToken(prompt, key, value), text)
}
