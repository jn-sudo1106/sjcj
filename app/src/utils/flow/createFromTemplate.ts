import { defineComponent, h, ref, type PropType } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { flowCenterApi, type FlowRecord } from '@/api'
import { instantiateStructureTemplate } from './flowTemplates'
import { copyWholeFlow } from './copiedConfigs'
import { reportDetachResult } from './applyTemplateToSource'
import { copiedPublishWarning } from './flowPublish'

/** 「暂不建流程」的取值：只在调用方传 allowNone 时出现 */
export const NO_FLOW_TEMPLATE = ''

interface TemplateOption {
  id: string
  name: string
  hint?: string
}

/** 弹窗里的单选卡片列表（替代原生 select，适配 13.6 寸屏：列表过长时自身滚动） */
const TemplateChoiceList = defineComponent({
  name: 'TemplateChoiceList',
  props: {
    options: { type: Array as PropType<TemplateOption[]>, required: true },
    initial: { type: String, required: true },
    onSelect: { type: Function as PropType<(id: string) => void>, required: true },
  },
  setup(props) {
    const current = ref(props.initial)
    const pick = (id: string) => {
      current.value = id
      props.onSelect(id)
    }
    return () =>
      h('div', { class: 'rc-tpl-list', role: 'radiogroup', 'aria-label': '所属流程模板' },
        props.options.map((option) =>
          h('label', {
            key: option.id || '__none__',
            class: ['rc-tpl-item', { 'is-active': current.value === option.id, 'is-none': option.id === NO_FLOW_TEMPLATE }],
            'data-testid': option.id === NO_FLOW_TEMPLATE ? 'flow-template-none' : `flow-template-${option.id}`,
          }, [
            h('input', {
              type: 'radio',
              name: 'rc-flow-template',
              value: option.id,
              checked: current.value === option.id,
              onChange: () => pick(option.id),
            }),
            h('span', { class: 'rc-tpl-text' }, [
              h('span', { class: 'rc-tpl-name' }, option.name),
              option.hint ? h('span', { class: 'rc-tpl-hint' }, option.hint) : null,
            ]),
          ]),
        ),
      )
  },
})

/**
 * 所有新建入口都先选择归属，取消时尚未创建流程。
 * allowNone：在列表最前加「暂不建流程」，选中时返回 NO_FLOW_TEMPLATE（空串），由调用方跳过建流程。
 */
export async function pickFlowTemplate(options: { excludeId?: string; message?: string; allowNone?: boolean } = {}): Promise<string> {
  const templates = (await flowCenterApi.templates()).filter(t => t.id !== options.excludeId)
  if (!templates.length && !options.allowNone) throw new Error('暂无流程模板，请先到流程中心新建模板')
  const choices: TemplateOption[] = [
    ...(options.allowNone
      ? [{ id: NO_FLOW_TEMPLATE, name: '暂不建流程', hint: '只建网站和源，之后在画布流程标签栏点「＋」再建' }]
      : []),
    ...templates.map(t => ({ id: t.id, name: t.name })),
  ]
  // 有模板时默认选第一个模板，保持原有默认；没有模板才落到「暂不建流程」
  let selected = templates[0]?.id ?? NO_FLOW_TEMPLATE
  await ElMessageBox.confirm(h('div', { class: 'rc-tpl-picker' }, [
    h('p', { class: 'rc-tpl-desc' }, options.message || '选择起始节点结构。创建后可独立调整节点与配置。'),
    h(TemplateChoiceList, { options: choices, initial: selected, onSelect: (id: string) => { selected = id } }),
  ]), '选择流程模板', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    customClass: 'rc-tpl-dialog',
  })
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
