import { h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, type FlowRecord } from '@/api'
import { instantiateStructureTemplate } from './flowTemplates'
import { copyWholeFlow } from './copiedConfigs'
import { reportDetachResult } from './applyTemplateToSource'
import { copiedPublishWarning } from './flowPublish'

/** 所有新建入口都先选择归属，取消时尚未创建流程。 */
export async function pickFlowTemplate(options: { excludeId?: string; message?: string } = {}): Promise<string> {
  const templates = (await flowCenterApi.templates()).filter(t => t.id !== options.excludeId)
  if (!templates.length) throw new Error('暂无流程模板，请先到流程中心新建模板')
  let selected = templates[0]!.id
  await ElMessageBox.confirm(h('div', [
    h('p', options.message || '选择起始节点结构。创建后可独立调整节点与配置。'),
    h('select', {
      class: 'rc-input', 'aria-label': '所属流程模板', value: selected,
      onChange: (event: Event) => { selected = (event.target as HTMLSelectElement).value },
      style: { width: '100%' },
    }, templates.map(t => h('option', { value: t.id }, t.name))),
  ]), '选择流程模板', { confirmButtonText: '使用此模板', cancelButtonText: '取消' })
  return selected
}

export async function createFlowFromTemplate(templateId: string, name: string, options: { reuseConfigs?: boolean } = {}): Promise<FlowRecord> {
  const template = await flowCenterApi.detail(templateId)
  if (!template || !template.isTemplate || template.disabled || template.state === 'D') throw new Error('请选择有效且启用的流程模板')
  if (template.definition.structureOnly) {
    return flowCenterApi.save({ name, definition: instantiateStructureTemplate(template.definition), fromTemplateId: templateId })
  }
  const { flowId, detach, publishError } = await copyWholeFlow(templateId, name, { sourceFlowRef: `模板「${template.name}」`, ...(options.reuseConfigs === undefined ? {} : { reuseConfigs: options.reuseConfigs }) })
  reportDetachResult(detach)
  if (publishError) ElMessage.warning(copiedPublishWarning(flowId, publishError))
  const created = await flowCenterApi.detail(flowId)
  if (!created) throw new Error(`流程已创建（#${flowId}），请刷新列表查看`)
  return created
}
