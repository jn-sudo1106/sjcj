import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { RunRow, RunNode, DataRow } from '../api'
import { isDataNode, isRuleNode, nodeOutputTable, collectorCapabilityOf, type FlowDef } from '@/views/FlowCanvas/canvas/flowModel'

// 运行时 store —— 发起抓取（mock）产生的运行数据的单一来源。
// 画布节点态、运行记录、数据查看三页都读它，与静态 mock 叠加，形成「发起抓取→run→落表」闭环。
let captureSeq = 1

export interface CaptureOptions {
  /** 任务级覆盖的登录节点；未传时按流程中的第一个登录节点解析。 */
  loginNodeId?: string
  /** 任务级覆盖的登录配置；不写回流程默认值。 */
  loginConfigId?: string
}

export const useRuntimeStore = defineStore('runtime', () => {
  const runs = ref<RunRow[]>([]) // 发起抓取产生的 run（叠加在 mock 之上）
  const runNodes = reactive<Record<string, RunNode[]>>({}) // run_id → 节点明细
  const nodeStates = reactive<Record<string, 'L' | 'C' | 'E'>>({}) // 画布节点 id → 运行态
  const dataByTable = reactive<Record<string, DataRow[]>>({}) // 发起抓取落表数据（按数据查看表 id）
  const lastRunId = ref('')
  const running = ref(false)

  const now = () => new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')

  // 可发起抓取判定：按节点能力判断，不再把登录/规则套入普通采集节点的 URL+输出表规则。
  function isRunnable(def: FlowDef, id: string): boolean {
    if (id === 'start' || id === 'end') return false
    const c = def.configs[id]
    if (!c || c.disabled || c.planned) return false
    if (c.collectCfg) {
      const capability = collectorCapabilityOf(c)
      if (!c.collectCfg.url) return false
      if (capability?.kind === 'login') {
        const configs = c.collectCfg.loginConfigs?.length
          ? c.collectCfg.loginConfigs
          : c.collectCfg.account || c.collectCfg.loginUrl
            ? [{
              id: 'legacy-default', loginUrl: c.collectCfg.loginUrl || c.collectCfg.url || '', loginName: c.collectCfg.account || '', loginPwd: '',
              newLoginConfig: '1' as const, authConfig: '', enabled: true,
            }]
            : []
        if (!configs.some((config) => config.enabled && (config.newLoginConfig === '0' ? config.authConfig.trim() : config.loginUrl.trim() && config.loginName.trim() && config.loginPwd.trim()))) return false
      }
      if (capability?.kind !== 'login' && !c.collectCfg.outputTable) return false
    } else if (isRuleNode(c)) {
      if (!c.ruleCfg?.ruleId || !c.ruleCfg.script?.trim()) return false
    } else if (isDataNode(c) && !nodeOutputTable(c)) {
      return false
    }
    return true
  }

  // 抓取运行器：给定一组已校验通过的节点 id，跑一次 L→C 流转 + 落表。
  function resolveLoginConfig(def: FlowDef, options?: CaptureOptions) {
    const loginNode = options?.loginNodeId
      ? def.configs[options.loginNodeId]
      : Object.values(def.configs).find((cfg) => collectorCapabilityOf(cfg)?.kind === 'login')
    const collect = loginNode?.collectCfg
    if (!collect) return undefined
    const configs = collect.loginConfigs?.length
      ? collect.loginConfigs
      : collect.account || collect.loginUrl
        ? [{
          id: 'legacy-default', loginUrl: collect.loginUrl || collect.url || '', loginName: collect.account || '', loginPwd: '',
          newLoginConfig: '1' as const, authConfig: '', enabled: true,
        }]
        : []
    const selected = options?.loginConfigId
      ? configs.find((item) => item.id === options.loginConfigId && item.enabled)
      : configs.find((item) => item.id === collect.defaultLoginConfigId && item.enabled)
        ?? configs.find((item) => item.enabled)
    if (!selected) return undefined
    return { nodeId: options?.loginNodeId, ...selected }
  }

  function runCapture(def: FlowDef, ids: string[], options?: CaptureOptions): string {
    const loginConfig = resolveLoginConfig(def, options)
    // 用户明确选择的配置如果已停用/删除，不能静默回退到默认配置，避免账号串用。
    if (options?.loginConfigId && !loginConfig) return ''
    // 运行 ID 前缀（0714 会议 Task 4）：用户可见，随「发起抓取」文案一并改名，不再叫 TRIAL
    const runId = `RUN-CAPTURE-${String(captureSeq++).padStart(2, '0')}`
    running.value = true
    lastRunId.value = runId
    const startedAt = now()

    ids.forEach((id) => {
      nodeStates[id] = 'L'
    })
    runNodes[runId] = ids.map((id) => {
      const cfg = def.configs[id]
      return {
        nodeId: id,
        name: cfg?.title ?? id,
        state: 'L',
        input: cfg?.collectCfg?.url ?? cfg?.inmap?.[0]?.name ?? '-',
        output: cfg?.collectCfg?.outputTable ?? cfg?.output?.[0]?.name ?? '-',
        failAction: '重试3次后告警',
        extTaskId: `TK-${runId}`,
        extTraceId: /规则/.test(cfg?.title ?? '') ? `TRACE-${runId}` : '-',
      }
    })
    const run: RunRow = {
      runId,
      flow: def.name,
      state: 'L',
      startedAt,
      owner: 'admin',
      ruleHits: 0,
      loginConfigId: loginConfig?.id,
      loginAccount: loginConfig?.loginName,
    }
    runs.value = [run, ...runs.value]

    // 逐节点 L→C 流转（mock 轮询模拟）
    ids.forEach((id, i) => {
      setTimeout(
        () => {
          nodeStates[id] = 'C'
          const n = runNodes[runId].find((x) => x.nodeId === id)
          if (n) n.state = 'C'
          if (i === ids.length - 1) {
            run.state = 'C'
            run.finishedAt = now()
            run.ruleHits = Math.floor(Math.random() * 8) + 4
            generateData(def, runId, ids)
            running.value = false
          }
        },
        (i + 1) * 600,
      )
    })
    return runId
  }

  // 整链发起抓取：跑主链和决策/分头分支段内所有可运行节点。
  function startCapture(def: FlowDef, options?: CaptureOptions): string {
    if (running.value) return ''
    const ids = def.main.filter((id) => isRunnable(def, id))
    // 0707 Phase6：chain 内节点也参与运行（按声明顺序追加）
    for (const bg of def.branchGroups ?? []) {
      for (const b of bg.branches) {
        for (const nid of b.chain) {
          if (isRunnable(def, nid) && !ids.includes(nid)) ids.push(nid)
        }
      }
    }
    if (!ids.length) return ''
    return runCapture(def, ids, options)
  }

  // 单节点运行（S7-1 改判：不是"整链从某节点起跑"，是"只跑这一个节点，不往下继续"）。
  // 纯前端模拟——真实 sendSnatch(sourceIds) 目前无法按节点范围发起抓取，暂不接入，避免"按钮说只跑一个节点，后端却重抓整个源"的误导。
  function runSingleNode(def: FlowDef, id: string, options?: CaptureOptions): { runId: string; reason?: string } {
    if (running.value) return { runId: '', reason: '已有发起抓取正在进行，请稍候' }
    if (!isRunnable(def, id)) return { runId: '', reason: '该节点当前不可运行（已停用 / 规划中 / 缺少必要配置）' }
    return { runId: runCapture(def, [id], options) }
  }

  // 落表：生成进入「数据查看」的实体数据，落到每个参与节点自己配置的输出表（不再写死 t-notice）
  function generateData(def: FlowDef, runId: string, ids: string[]) {
    const outputTables = new Set<string>()
    ids.forEach((id) => {
      const c = def.configs[id]
      const table = c ? nodeOutputTable(c) : ''
      if (table) outputTables.add(table)
    })
    if (!outputTables.size) outputTables.add('t-notice')

    outputTables.forEach((table, i) => {
      const cfg = ids.map((id) => def.configs[id]).find((c) => c && nodeOutputTable(c) === table)
      const rows: DataRow[] = [
        {
          dataId: `${runId}-${String(i + 1).padStart(3, '0')}`,
          title: `发起抓取落表 · ${def.source?.name ?? cfg?.title ?? '网页抓取'}`,
          summary: `来自流程「${def.name}」`,
          sourceId: def.source?.configId ?? '—',
          configId: def.source?.configId,
          taskId: `TK-${runId}`,
          runId,
          acceptState: 'pending',
          fileType: 'html',
          parseState: 'parsed',
        },
      ]
      dataByTable[table] = [...rows, ...(dataByTable[table] ?? [])]
    })
  }

  function clearNodeStates(ids?: string[]) {
    if (!ids) {
      Object.keys(nodeStates).forEach((k) => delete nodeStates[k])
    } else {
      ids.forEach((id) => delete nodeStates[id])
    }
  }

  return { runs, runNodes, nodeStates, dataByTable, lastRunId, running, startCapture, runSingleNode, clearNodeStates }
})
