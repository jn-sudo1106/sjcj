/**
 * 节点提示词接口（flow/node-prompts*）只在独立流程后端上有，业务后端没有——2026-10-26 实测 217
 * 四个路径都返回 500 空体，与不存在的路径一致。没配 VITE_FLOW_PROXY_TARGET 时请求会落到业务后端，
 * 所以只在配了它时调用（与 fetchPromptList 走新接口的条件一致）。业务后端补上接口后删掉本函数即可。
 * 此判断仅用于接口契约适配，不控制页面入口是否显示。
 */
export function nodePromptsAvailable(): boolean {
  return !!import.meta.env.VITE_FLOW_PROXY_TARGET
}
