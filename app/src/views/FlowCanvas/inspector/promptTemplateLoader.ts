import { fetchPromptList } from '@/api/prompt'
import type { PromptCategory, RuleFieldOption } from '@/api'
import { applyPromptTemplate } from '@/utils/flow/promptTemplate'

export interface PromptTemplateLoadContext {
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
}

export async function loadPromptTemplateForNode(context: PromptTemplateLoadContext): Promise<string | null> {
  const list = await fetchPromptList(context.promptListCategory, context.promptCategory)
  const template = list[0]?.systemPrompt?.trim()
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
  })
}
