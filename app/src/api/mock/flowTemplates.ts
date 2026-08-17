import type { FlowTemplate, FlowTemplateSaveInput } from '../types'
import { makePresetFlowTemplates, sanitizeTemplateDefinition } from '@/utils/flow/flowTemplates'

const STORAGE_KEY = 'sjcj.flow-templates.v1'

type TemplateVersions = Record<string, FlowTemplate[]>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedVersions(): TemplateVersions {
  return Object.fromEntries(makePresetFlowTemplates().map((template) => [template.id, [template]]))
}

function readVersions(): TemplateVersions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as TemplateVersions
  } catch {
    // 损坏的本地演示数据回退为种子模板。
  }
  return seedVersions()
}

function writeVersions(versions: TemplateVersions): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(versions))
}

function latest(versions: FlowTemplate[]): FlowTemplate | undefined {
  return versions[versions.length - 1]
}

function now(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

export function mockFlowTemplateList(): FlowTemplate[] {
  return Object.values(readVersions())
    .map(latest)
    .filter((template): template is FlowTemplate => Boolean(template))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(clone)
}

export function mockFlowTemplateDetail(params?: Record<string, unknown>): FlowTemplate | null {
  const id = String(params?.id ?? '')
  const version = Number(params?.version ?? 0)
  const versions = readVersions()[id]
  if (!versions?.length) return null
  const template = version ? versions.find((item) => item.version === version) : latest(versions)
  return template ? clone(template) : null
}

/** 每次保存同一 id 都生成新版本；旧版本继续供已绑定源读取，不会被静默覆盖。 */
export function mockFlowTemplateSave(params?: Record<string, unknown>): FlowTemplate {
  const input = params?.template as FlowTemplateSaveInput | undefined
  const name = input?.name?.trim()
  if (!input?.definition || !name) throw new Error('模板名称和结构不能为空')

  const all = readVersions()
  const id = input.id || `tpl-${Date.now().toString(36)}`
  const versions = all[id] ?? []
  const template: FlowTemplate = {
    id,
    name,
    version: (latest(versions)?.version ?? 0) + 1,
    definition: sanitizeTemplateDefinition(input.definition),
    updatedAt: now(),
  }
  all[id] = [...versions, template]
  writeVersions(all)
  return clone(template)
}
