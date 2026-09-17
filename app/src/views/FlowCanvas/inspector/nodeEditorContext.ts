// 节点编辑上下文（0917）：把「现在编辑哪个节点、改动写回哪里」从全局 flow store 里抽出来一层。
//
// 起因：「监控视图 → 监控配置」要求跟数据监控节点的「编排配置」是**同一套页面功能**
//（监控方法 / 设置业务规则 / 模型供应商 / 模型 / 生成脚本 / 测试脚本 / 告警配置）。
// 那套 UI（RuleOrchestrationTab）原本写死了 useFlowStore()，而网站汇总态没有画布，
// 也不该去动主画布正在编辑的那份对象（见 SiteMonitorConfigView 头注：它按源自己拼一份种子）。
//
// 所以把 Tab 里那几处读写收成这个接口：**谁 provide，Tab 就写谁**。
// 默认实现（没 provide 时）就是抽上下文之前的行为——直接读写 flow store，
// 画布侧的 NodeInspector / 现有测试都走默认实现，行为不变。
import { computed, inject, provide, type InjectionKey, type Ref } from 'vue'
import { useFlowStore } from '@/stores/flow'
import { isRuleNode, type CollectorSchedule, type MonitorAlertConfig, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'
import type { RuleOrchestration } from '@/api'

export interface NodeEditorContext {
  /** 正在编辑的节点 id（编排字段的写回目标） */
  id: Ref<string>
  /** 正在编辑的节点本身 */
  cfg: Ref<NodeConfig | undefined>
  /** 写回编排字段：规则/监控节点写 ruleCfg，其余写 execCfg（与 node store 同口径） */
  patch: (patch: Partial<RuleOrchestration>) => void
  setMonitorMethods: (values: string[]) => void
  setMonitorAlertConfig: (config: MonitorAlertConfig) => void
  /** 系统提示词 `{{source_id}}` 与 ck_source 同步用的源 id */
  sourceId: Ref<string>
  /** 节点自己没配过定时时的兜底调度（画布 = 当前源，网站态 = 所选源） */
  sourceSchedule: Ref<CollectorSchedule | null | undefined>
}

const KEY: InjectionKey<NodeEditorContext> = Symbol('NodeEditorContext')

/** 宿主组件调用：提供一个本地节点编辑上下文（网站汇总态的监控视图用）。 */
export function provideNodeEditorContext(ctx: NodeEditorContext): NodeEditorContext {
  provide(KEY, ctx)
  return ctx
}

/** 画布侧默认实现：读写全局 flow store，等价于抽上下文之前那些 `flow.*` 调用。 */
function flowStoreNodeEditorContext(): NodeEditorContext {
  const flow = useFlowStore()
  return {
    id: computed(() => flow.selectedId),
    cfg: computed(() => flow.selectedNode),
    patch: (p) => {
      if (isRuleNode(flow.selectedNode)) flow.patchRuleConfig(flow.selectedId, p)
      else flow.patchExecConfig(flow.selectedId, p)
    },
    setMonitorMethods: (values) => flow.setMonitorMethods(flow.selectedId, values ?? []),
    setMonitorAlertConfig: (config) => flow.setMonitorAlertConfig(flow.selectedId, config),
    // `source_id` 取**画布当前正在编辑的那个源**（左侧源列表里选中的），不是节点的 stepSourceId——
    // 后者对规则/监控节点恒为 -1，拼进提示词会让监控脚本查不到数据（见 RuleOrchestrationTab 里的长注）。
    sourceId: computed(() => flow.sourceCfg?.sourceId || flow.sourceCtx?.sourceId || ''),
    sourceSchedule: computed(() => flow.sourceCfg),
  }
}

/** Tab 子组件调用：取注入的上下文，没有就回落到画布默认实现。 */
export function useNodeEditorContext(): NodeEditorContext {
  return inject(KEY) ?? flowStoreNodeEditorContext()
}
