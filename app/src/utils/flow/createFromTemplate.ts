import { shallowRef } from 'vue'
import { ElMessage } from 'element-plus'
import { flowCenterApi, type FlowRecord } from '@/api'
import { instantiateStructureTemplate } from './flowTemplates'
import { copyWholeFlow } from './copiedConfigs'
import { reportDetachResult } from './applyTemplateToSource'
import { copiedPublishWarning, copiedRootWarning } from './flowPublish'

/** 「暂不建流程」的取值：只在调用方传 allowNone 时出现 */
export const NO_FLOW_TEMPLATE = ''

export interface FlowTemplatePickRequest {
  templates: FlowRecord[]
  allowNone: boolean
  message?: string
  initialId: string
  resolve: (templateId: string) => void
  reject: (reason: unknown) => void
}

/**
 * 当前待处理的选模板请求：由 App 里挂的 FlowTemplatePickerHost 渲染成带节点 / 表预览的弹窗
 *（1123 A1：添加时就能看到流程节点和表配置）。同一时间只有一个，新请求顶掉旧的（旧的按取消处理）。
 */
export const flowTemplatePickRequest = shallowRef<FlowTemplatePickRequest | null>(null)

const LAST_TEMPLATE_KEY = 'rc-last-flow-template'
/** 上次选过的模板（本机记忆），新建时默认选它 */
export function lastFlowTemplateId(): string {
  try { return localStorage.getItem(LAST_TEMPLATE_KEY) ?? '' } catch { return '' }
}
export function rememberFlowTemplate(id: string): void {
  if (!id) return
  try { localStorage.setItem(LAST_TEMPLATE_KEY, id) } catch { /* 存储不可用不影响选择 */ }
}

/** 可选的模板：排除停用 / 已删的（createFlowFromTemplate 会拒绝它们） */
export async function availableFlowTemplates(excludeId?: string): Promise<FlowRecord[]> {
  return (await flowCenterApi.templates()).filter(t => t.id !== excludeId && !t.disabled && t.state !== 'D')
}

/**
 * 所有新建入口都先选择归属，取消时尚未创建流程（reject 'cancel'）。
 * allowNone：在列表最后加「暂不配置流程」，选中时返回 NO_FLOW_TEMPLATE（空串），由调用方跳过建流程。
 * initialId：默认选中的模板；不给时用上次选过的模板，再没有取第一个。
 */
export async function pickFlowTemplate(options: { excludeId?: string; message?: string; allowNone?: boolean; initialId?: string } = {}): Promise<string> {
  const templates = await availableFlowTemplates(options.excludeId)
  if (!templates.length && !options.allowNone) throw new Error('暂无流程模板，请先到流程中心新建模板')
  const initialId = options.initialId ?? lastFlowTemplateId()
  return new Promise<string>((resolve, reject) => {
    flowTemplatePickRequest.value?.reject('cancel')
    flowTemplatePickRequest.value = {
      templates,
      allowNone: !!options.allowNone,
      message: options.message,
      initialId,
      resolve: (id) => {
        flowTemplatePickRequest.value = null
        rememberFlowTemplate(id)
        resolve(id)
      },
      reject: (reason) => {
        flowTemplatePickRequest.value = null
        reject(reason)
      },
    }
  })
}

export async function createFlowFromTemplate(templateId: string, name: string, options: { reuseConfigs?: boolean } = {}): Promise<FlowRecord> {
  const template = await flowCenterApi.detail(templateId)
  if (!template || !template.isTemplate || template.disabled || template.state === 'D') throw new Error('请选择有效且启用的流程模板')
  if (template.definition.structureOnly) {
    return flowCenterApi.save({ name, definition: instantiateStructureTemplate(template.definition), fromTemplateId: templateId })
  }
  const { flowId, detach, publishError, rootError } = await copyWholeFlow(templateId, name, { sourceFlowRef: `模板「${template.name}」`, ...(options.reuseConfigs === undefined ? {} : { reuseConfigs: options.reuseConfigs }) })
  reportDetachResult(detach)
  if (rootError) ElMessage.warning(copiedRootWarning(flowId, rootError))
  if (publishError) ElMessage.warning(copiedPublishWarning(flowId, publishError))
  const created = await flowCenterApi.detail(flowId)
  if (!created) throw new Error(`流程已创建（#${flowId}），请刷新列表查看`)
  return created
}
