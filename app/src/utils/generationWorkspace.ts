import type { ModelInterface } from '@/api/runnerManagement'

export function createGenerationTaskId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Paths belong to the model server, whose OS may differ from the browser's. */
export function generationWorkspace(config: ModelInterface, taskId: string) {
  const root = config.prjDir?.trim() || ''
  const separator = root.includes('\\') || /^[A-Za-z]:/.test(root) ? '\\' : '/'
  const instanceId = config.generationServerId || config.id || '{实例ID}'
  const base = [root.replace(/[\\/]+$/, ''), instanceId].join(separator)
  return { instanceId, taskId, prjDir: base, inputFileDir: `${base}${separator}input`,
    codeDir: `${base}${separator}code`, outputFileDir: `${base}${separator}output`, taskRecordPath: `${base}${separator}tasks${separator}${taskId}.json` }
}
