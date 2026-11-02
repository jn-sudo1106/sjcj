import type { CodeGenerationServer, ModelInterface } from '@/api/runnerManagement'

export function matchingGenerationGitBinding(server: CodeGenerationServer | undefined, directory: string) {
  if (!server) return undefined
  const windows = /[\\]|^[A-Za-z]:/.test(server.workspace)
  const normalize = (value: string) => {
    const path = value.replaceAll('\\', '/').replace(/\/+$/, '')
    return windows ? path.toLowerCase() : path
  }
  const workspace = normalize(server.workspace), path = normalize(directory)
  const absolute = /^(?:[A-Za-z]:[\\/]|[\\/])/.test(directory)
  if (absolute && path !== workspace && !path.startsWith(workspace + '/')) return undefined
  const relative = absolute ? path.slice(workspace.length).replace(/^\//, '') : path
  return server.generationGitBindings?.filter(item => {
    const owner = normalize(item.path)
    return !owner || relative === owner || relative.startsWith(owner + '/')
  }).sort((a, b) => b.path.length - a.path.length)[0]
}

export function nodeGenerationCodeDirectory(root: string, configId: string, queueName: string, settings: {
  workspaceMode?: 'config-queue' | 'config' | 'queue' | 'custom'; workspacePath?: string; codeDirectory?: string
} = {}) {
  const separator = root.includes('\\') || /^[A-Za-z]:/.test(root) ? '\\' : '/'
  const join = (...parts: string[]) => parts.filter(Boolean).join(separator).replace(/[\\/]/g, separator)
  const base = root.replace(/[\\/]+$/, '')
  const withRoot = (value: string) => base ? join(base, value) : (root.startsWith('/') ? '/' : '') + value
  const override = settings.codeDirectory?.trim()
  if (override) return /^(?:[A-Za-z]:[\\/]|[\\/])/.test(override) ? override : withRoot(override)
  const mode = settings.workspaceMode || 'config'
  const owner = mode === 'config' || mode === 'config-queue' ? configId : mode === 'queue' ? queueName : settings.workspacePath || '请输入相对目录'
  return withRoot(join(owner, 'code'))
}

export function createGenerationTaskId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Paths belong to the model server, whose OS may differ from the browser's. */
export function generationWorkspace(config: ModelInterface, taskId: string) {
  const root = config.prjDir?.trim() || ''
  const separator = root.includes('\\') || /^[A-Za-z]:/.test(root) ? '\\' : '/'
  const instanceId = config.generationServerId || config.id || '{实例ID}'
  const base = root.replace(/[\\/]+$/, '') || separator
  const child = (name: string) => `${base.endsWith(separator) ? base : base + separator}${name}`
  return { instanceId, taskId, prjDir: root, inputFileDir: child('input'),
    codeDir: child('code'), outputFileDir: child('output'), taskRecordPath: child(`tasks${separator}${taskId}.json`) }
}
