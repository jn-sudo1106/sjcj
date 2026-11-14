// 流程中心「模板 → 实例」客户端（1109 方案 §5、§12 C02/C09/C10/C12）。
//
// 这一层只做「契约形状 → 页面可用形状」的收敛，不吞异常：后端能力未就绪时，
// 由 endpoints.ts 里这批端点「不标 live」决定走 mock（见 mock/flowCenterCenter.ts），
// 页面拿到的形状完全一致；接真实后端时只改 endpoints.ts 的 httpEndpoint / live。
import { request } from './client'
import type {
  BatchJob,
  ConfigDiffResult,
  InstanceDraftPayload,
  InstanceDraftResult,
  InstancePageCond,
  InstanceRow,
  Paged,
  ScopeIntent,
  ScopePreview,
  StartBatchPayload,
  TemplateMeta,
  UnclassifiedResult,
} from './types/flowCenterCenter'

const EP = {
  templateMetas: 'flow-center/templateMetas',
  instancePaged: 'flow-center/instancePaged',
  scopePreview: 'flow-center/scopePreview',
  instanceDraft: 'flow-center/instanceDraft',
  instanceActivate: 'flow-center/instanceActivate',
  bindFlowsByScope: 'flow-center/bindFlowsByScope',
  batchJob: 'flow-center/batchJob',
  instanceDiff: 'flow-center/instanceDiff',
  unclassified: 'flow-center/unclassified',
  unclassifiedAssign: 'flow-center/unclassifiedAssign',
  unclassifiedStatus: 'flow-center/unclassifiedStatus',
} as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

/** 模板摘要：左栏与结构预览用。 */
export async function fetchTemplateMetas(): Promise<TemplateMeta[]> {
  const res = await request<TemplateMeta[] | null>(EP.templateMetas, {}, { method: 'GET' })
  return Array.isArray(res) ? res : []
}

/** 实例分页：主区表格用。 */
export async function fetchInstancePaged(cond: InstancePageCond): Promise<Paged<InstanceRow>> {
  const page = cond.page ?? 1
  const pageSize = cond.pageSize ?? 20
  const res = await request<Paged<InstanceRow> | null>(EP.instancePaged, {
    templateId: cond.templateId,
    site: cond.site,
    status: cond.status ?? 'all',
    keyword: cond.keyword,
    page,
    pageSize,
  }, { method: 'GET' })
  const raw = asRecord(res)
  const list = Array.isArray(raw.list) ? raw.list as InstanceRow[] : []
  return { list, total: Number(raw.total ?? list.length), page: Number(raw.page ?? page), pageSize: Number(raw.pageSize ?? pageSize) }
}

/** 范围预览（C09）：保存草稿前给出冻结范围内的四类计数。 */
export async function previewScope(templateId: string, scope: ScopeIntent): Promise<ScopePreview> {
  const res = await request<ScopePreview | null>(EP.scopePreview, { templateId, scope }, { method: 'POST' })
  return (res ?? {
    templateId,
    total: 0,
    toAdd: 0,
    toSkip: 0,
    groupSources: 0,
    expectedUnavailable: 0,
    defaultFilled: 0,
  }) as ScopePreview
}

/** 保存实例草稿（C12）：只写实例与范围意图，不建立绑定、不可执行。 */
export async function createInstanceDraft(payload: InstanceDraftPayload): Promise<InstanceDraftResult> {
  const res = await request<InstanceDraftResult | null>(EP.instanceDraft, payload as unknown as Record<string, unknown>, { method: 'POST' })
  if (!res || !res.id) throw new Error('保存草稿失败：后端未返回实例 ID')
  return res
}

/** 激活草稿并提交绑定作业（C12 → C09）：返回首次作业快照，后续用 batchJob 轮询。 */
export async function activateInstance(instanceId: string, scopeToken: string, scope: ScopeIntent): Promise<BatchJob> {
  const res = await request<BatchJob | null>(EP.instanceActivate, { instanceId, scopeToken, scope } as unknown as Record<string, unknown>, { method: 'POST' })
  if (!res || !res.jobId) throw new Error('激活失败：后端未返回作业 ID')
  return res
}

/** 直接按冻结范围提交批量绑定（已生效实例追加/更换关联时用）。 */
export async function startBatchBind(payload: StartBatchPayload): Promise<BatchJob> {
  const res = await request<BatchJob | null>(EP.bindFlowsByScope, payload as unknown as Record<string, unknown>, { method: 'POST' })
  if (!res || !res.jobId) throw new Error('提交失败：后端未返回作业 ID')
  return res
}

/** 轮询作业进度（C09）。 */
export async function fetchBatchJob(jobId: string): Promise<BatchJob> {
  const res = await request<BatchJob | null>(EP.batchJob, { jobId }, { method: 'GET' })
  if (!res) throw new Error('作业不存在或已过期')
  return res
}

/** 实例配置差异（C11）。 */
export async function fetchInstanceDiff(baseId: string, compareId: string): Promise<ConfigDiffResult> {
  return request<ConfigDiffResult>(EP.instanceDiff, { baseId, compareId }, { method: 'GET' })
}

/** 未归类核对清单（C10）。 */
export async function fetchUnclassified(params: { keyword?: string } = {}): Promise<UnclassifiedResult> {
  const res = await request<UnclassifiedResult | null>(EP.unclassified, params, { method: 'GET' })
  const raw = asRecord(res)
  return {
    list: Array.isArray(raw.list) ? raw.list as UnclassifiedResult['list'] : [],
    total: Number(raw.total ?? 0),
    scannedAt: String(raw.scannedAt ?? ''),
  }
}

/** 单条归集到模板（C10；批量归集本期不做）。 */
export async function assignUnclassified(id: string, templateId: string): Promise<void> {
  await request(EP.unclassifiedAssign, { id, templateId }, { method: 'POST' })
}

/** 单条核对状态（待确认 / 已确认 / 忽略）。 */
export async function setUnclassifiedStatus(id: string, status: 'pending' | 'confirmed' | 'skipped'): Promise<void> {
  await request(EP.unclassifiedStatus, { id, status }, { method: 'POST' })
}