import { fetchPromptList } from '@/api/prompt'
import type { PromptCategory, RuleFieldOption } from '@/api'
import { applyPromptTemplate } from '@/utils/flow/promptTemplate'
import type { PromptTemplateItem } from '@/api/prompt'

export interface PromptTemplateLoadContext {
  promptTemplateId?: number
  promptListCategory: string
  promptCategory: PromptCategory
  inputTableName: string
  outputTableName: string
  sourceId?: string
  sourceCron?: string
  inputFields: string[]
  outputFields: string[]
  inputFieldOptions: RuleFieldOption[]
  outputFieldOptions: RuleFieldOption[]
  providerCode?: string
  model?: string
  describe?: string
}

export async function loadPromptTemplateForNode(context: PromptTemplateLoadContext): Promise<string | null> {
  const list = await fetchPromptList(context.promptListCategory, context.promptCategory)
  const row = context.promptTemplateId ? list.find(item => item.promptId === context.promptTemplateId) : list[0]
  return row ? renderPromptTemplateForNode(row, context) : null
}

export function renderPromptTemplateForNode(row: PromptTemplateItem, context: PromptTemplateLoadContext): string | null {
  const template = [row?.systemPrompt?.trim(), row?.userPromptTemplate?.trim()].filter(Boolean).join('\n\n')
  if (!template) return null
  return applyPromptTemplate(template, {
    inputTableName: context.inputTableName,
    outputTableName: context.outputTableName,
    sourceId: context.sourceId,
    sourceCron: context.sourceCron,
    inputFields: context.inputFields,
    outputFields: context.outputFields,
    inputFieldOptions: context.inputFieldOptions,
    outputFieldOptions: context.outputFieldOptions,
    providerCode: context.providerCode,
    model: context.model,
    describe: context.describe,
  })
}
