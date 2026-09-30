// 复制流程前的确认框（0930）：带「新增一套配置 / 复用原配置」二选一。
// 流程中心「复制流程」、画布「复制当前流程」「更换流程」共用。
//
// 默认「新增一套配置」＝ 0929 F2 红线（复制品的改动不影响原流程）；「复用原配置」是用户显式选择的例外：
// 节点仍指向原来的配置，改任一边的节点配置两边一起变——确认框里写明，不再额外登记知情确认。
import { h, ref } from 'vue'
import { ElMessageBox, ElRadio, ElRadioGroup } from 'element-plus'

export type CopyConfigMode = 'new' | 'reuse'

const OPTION_TEXT: Record<CopyConfigMode, [string, string]> = {
  new: ['新增一套配置', '每个节点复制一份独立配置，修改新流程不影响原流程（推荐）'],
  reuse: ['复用原配置', '节点仍指向原来的配置，修改任一边的节点配置，两边会一起变'],
}

/** 弹确认框；取消返回 null，确认返回选中的配置方式 */
export async function confirmCopyFlow(opts: {
  title: string
  lines: string[]
  confirmText: string
}): Promise<CopyConfigMode | null> {
  const mode = ref<CopyConfigMode>('new')
  const option = (value: CopyConfigMode) => h(ElRadio, { value, class: 'copy-flow-option' }, () => [
    h('b', OPTION_TEXT[value][0]),
    h('span', { class: 'copy-flow-option-desc' }, OPTION_TEXT[value][1]),
  ])
  try {
    await ElMessageBox.confirm(
      () => h('div', { class: 'copy-flow-confirm' }, [
        ...opts.lines.filter(Boolean).map((line) => h('p', line)),
        h(ElRadioGroup, {
          modelValue: mode.value,
          'onUpdate:modelValue': (v: string | number | boolean | undefined) => { mode.value = v as CopyConfigMode },
          class: 'copy-flow-options',
          'data-testid': 'copy-flow-config-mode',
        }, () => [option('new'), option('reuse')]),
      ]),
      opts.title,
      { confirmButtonText: opts.confirmText, cancelButtonText: '取消', customClass: 'copy-flow-box' },
    )
  } catch {
    return null
  }
  return mode.value
}
