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
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceToken(text: string, key: string, value: string): string {
  const bracePattern = new RegExp(escapeRegExp(`{{${key}}}`), 'g')
  const barePattern = new RegExp(`\\b${escapeRegExp(key)}\\b(?!\\s*=)`, 'g')
  return text.replace(bracePattern, value).replace(barePattern, value)
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
  return [
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
  ].reduce((text, [key, value]) => replaceToken(text, key, value), template)
}
