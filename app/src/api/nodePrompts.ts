import { request } from './client'
import type { PromptTemplateItem } from './prompt'

export type TemplateUse = 'config' | 'script'
export interface NodePromptTemplate extends Omit<PromptTemplateItem, 'version'> {
  promptName: string
  templateUse: TemplateUse
  revision: string
}
export const nodePromptApi = {
  list: (params: { sourceType?: string; nodeTypeName?: string; category?: string; templateUse: TemplateUse }) =>
    request<NodePromptTemplate[]>('flow/node-prompts', params, { mode: 'http', method: 'GET', backendScope: 'flow' }),
  save: (input: Partial<NodePromptTemplate> & { sourceType: string }) =>
    request<NodePromptTemplate>('flow/node-prompts/save', input, { mode: 'http', method: 'POST', backendScope: 'flow' }),
  selection: (configId: string) => request<{ promptTemplateId: number; hasSelection?: boolean }>('flow/node-prompts/selection', { configId, templateUse: 'config' }, { mode: 'http', method: 'GET', backendScope: 'flow' }),
  select: (configId: string, promptTemplateId: number) => request<{ promptTemplateId: number }>('flow/node-prompts/selection/save', { configId, promptTemplateId, templateUse: 'config' }, { mode: 'http', method: 'POST', backendScope: 'flow' }),
}

export function defaultNodePrompt(rows: NodePromptTemplate[], requireDefault = false) {
  const enabled = rows.filter(row => row.isActive === 1)
  return enabled.find(row => row.isDefault === 1) ?? (requireDefault ? undefined : enabled[0])
}

/** Only explicit placeholders are substituted; replacement text is never reinterpreted. */
export function fillNodePrompt(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key: string) => variables[key] ?? token)
}
