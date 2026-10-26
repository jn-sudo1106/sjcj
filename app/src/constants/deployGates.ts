/**
 * 部署环境（2806 / 2807）还没有的两个服务，对应入口在部署构建里隐藏，本地开发照常显示（2026-10-09）：
 * - Runner 管理服务：网关没有转发 `/api/runner-management`，请求会落到业务后端 404；
 * - 站点脚本生成服务：网关把 `/api/ai/site-script/` 转到容器内 127.0.0.1:8091，但镜像里没有这个服务。
 * 服务部署上线后，删掉对应函数及其调用即可。
 */
export function runnerManagementAvailable(): boolean {
  return import.meta.env.DEV
}

export function siteScriptAiAvailable(): boolean {
  return import.meta.env.DEV
}

/**
 * 节点提示词接口（flow/node-prompts*）只在独立流程后端上有，业务后端没有——2026-10-26 实测 217
 * 四个路径都返回 500 空体，与不存在的路径一致。没配 VITE_FLOW_PROXY_TARGET 时请求会落到业务后端，
 * 所以只在配了它时调用（与 fetchPromptList 走新接口的条件一致）。业务后端补上接口后删掉本函数即可。
 */
export function nodePromptsAvailable(): boolean {
  return !!import.meta.env.VITE_FLOW_PROXY_TARGET
}
