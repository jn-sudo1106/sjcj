import type { ModelInterface } from '@/api/runnerManagement'

export const ALL_AGENTS = 'all'
export const isAgentInterface = (item: ModelInterface) => ['agent', 'gemini-agent'].includes(item.kind)
export const isOnlineAgentInterface = (item: ModelInterface) => item.enabled && isAgentInterface(item)
  && ['idle', 'busy'].includes(item.runtimeStatus || 'idle')
  && !['offline', 'missing', 'ambiguous'].includes(item.generationServerMatch || '')
export const agentStatusLabel = (item: ModelInterface) => ({ idle: '空闲', busy: '忙碌', offline: '离线', disabled: '禁用' })[item.runtimeStatus || (item.enabled ? 'idle' : 'disabled')]
export const allAgentsOption: ModelInterface = {
  id: ALL_AGENTS, name: '全选 · 任意空闲智能体', kind: 'agent', model: '', endpoint: '',
  enabled: true, isDefault: false, timeoutSeconds: 300, inputFileDir: '', codeDir: '', outputFileDir: '', stream: true,
}
