import type { EntryField } from '@/api'

export type SiteScriptOutputField = Pick<EntryField, 'prop' | 'desc' | 'itemId' | 'columnName'>

const queueBlock = /(?:\n\n)?【当前节点 MQ 主题】\n[\s\S]*?\n【MQ 主题结束】/g

export function withSiteScriptQueuePrompt(prompt: string, queueName = ''): string {
  const body = prompt.replace(queueBlock, '')
  const queue = queueName.trim()
  return queue ? `${body}${body ? '\n\n' : ''}【当前节点 MQ 主题】\nMQ 主题：${queue}\n【MQ 主题结束】` : body
}

const fieldBlock = /(?:\n\n)?【当前节点输出字段】\n[\s\S]*?\n【输出字段结束】/g

/** Replace only the generated field block, preserving the user's instructions. */
export function withSiteScriptOutputFields(prompt: string, fields: SiteScriptOutputField[] = [], table = ''): string {
  const body = prompt.replace(fieldBlock, '')
  if (!fields.length) return body
  const lines = fields.map(field => [
    `字段名：${field.desc || field.prop}`,
    `字段 ID：${field.itemId || field.prop}`,
    ...(field.itemId && field.itemId !== field.prop ? [`字段标识：${field.prop}`] : []),
    ...(field.columnName ? [`物理列：${field.columnName}`] : []),
  ].join('；'))
  return `${body}${body ? '\n\n' : ''}【当前节点输出字段】\n${table ? `输出表：${table}\n` : ''}${lines.map(line => `- ${line}`).join('\n')}\n【输出字段结束】`
}
