import { isRuleNode, isRuleLikeNode, isPdfNode, type FieldOption, type NodeConfig } from '@/views/FlowCanvas/canvas/flowModel'

export function inputFieldTokens(cfg: NodeConfig | undefined): string[] {
  if (!cfg) return []
  // 每类节点先读各自的真值，读不到再退回 NodeConfig.inputFields——那是 0806 之前的草稿位，
  // 老的流程 XML 导入还在用它（flowXml 导出/导入是同一把尺子，不能只认新口径）。
  if (isRuleNode(cfg)) return cfg.ruleCfg?.inputFields ?? cfg.inputFields ?? []
  if (isRuleLikeNode(cfg) || isPdfNode(cfg)) return cfg.execCfg?.inputFields ?? cfg.inputFields ?? []
  return cfg.taskCfg?.contextMap ?? cfg.inputFields ?? []
}

/**
 * 该节点是否**已经就输入字段做过明确选择**（2026-11-04 F2 收口）。
 *
 * - `false`：未指定。保存时 `mergeStepForWrite` 走 `?? snapshot?.contextMap` 兜底，
 *   也就是沿用这个步骤上一次保存的 context；
 * - `true` 且选择为空：明确清空。保存后步骤 context 落 `null`，不再沿用旧列。
 *
 * 两种状态在界面上都是「一个没勾」，但语义相反——不分开显示的话，用户清空后以为不传字段，
 * 实际还在沿用旧列（旧平台回读空 context 时是 undefined，同样落回这个分支）。
 */
export function inputFieldsSpecified(cfg: NodeConfig | undefined): boolean {
  if (!cfg) return false
  if (isRuleNode(cfg)) return cfg.ruleCfg?.inputFields !== undefined || cfg.inputFields !== undefined
  if (isRuleLikeNode(cfg) || isPdfNode(cfg)) return cfg.execCfg?.inputFields !== undefined || cfg.inputFields !== undefined
  // 普通节点：context 是持久化真值；inputFields 只兼容尚未迁移的本地草稿。
  return cfg.taskCfg?.contextMap !== undefined || cfg.inputFields !== undefined
}

/** context 是普通节点的持久化真值；inputFields 仅兼容尚未迁移的本地草稿。 */
export function inputFieldSelection(cfg: NodeConfig | undefined, fields: FieldOption[]) {
  const tokens = inputFieldTokens(cfg)
  const propByToken = new Map<string, string>()
  for (const field of fields) {
    propByToken.set(field.prop, field.prop)
    if (field.columnName) propByToken.set(field.columnName, field.prop)
  }
  return {
    selected: [...new Set(tokens.map((token) => propByToken.get(token)).filter((prop): prop is string => !!prop))],
    unknown: tokens.filter((token) => !propByToken.has(token)),
    specified: inputFieldsSpecified(cfg),
  }
}