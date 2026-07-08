import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { RunRow, RunNode, DataRow } from '../api'
import { isDataNode, nodeOutputTable, type FlowDef } from '../views/FlowCanvas/flowModel'

// 运行时 store —— 试跑（mock）产生的运行数据的单一来源。
// 画布节点态、运行记录、数据查看三页都读它，与静态 mock 叠加，形成「试跑→run→落表」闭环。
let trialSeq = 1

export const useRuntimeStore = defineStore('runtime', () => {
  const runs = ref<RunRow[]>([]) // 试跑产生的 run（叠加在 mock 之上）
  const runNodes = reactive<Record<string, RunNode[]>>({}) // run_id → 节点明细
  const nodeStates = reactive<Record<string, 'L' | 'C' | 'E'>>({}) // 画布节点 id → 运行态
  const dataByTable = reactive<Record<string, DataRow[]>>({}) // 试跑落表数据（按数据查看表 id）
  const lastRunId = ref('')
  const running = ref(false)

  const now = () => new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')

  // 单节点可试跑判定：已停止 / 规划中（待执行器）/ 采集节点缺 URL 或输出表（待配置）/
  // 非采集数据节点缺输出表均不可试跑，与画布 footFor 的「已停止/规划中/待配置」文案保持一致，避免误导为已跑通。
  function isRunnable(def: FlowDef, id: string): boolean {
    if (id === 'start' || id === 'end') return false
    const c = def.configs[id]
    if (!c || c.disabled || c.planned) return false
    if (c.collectCfg) {
      if (!(c.collectCfg.url && c.collectCfg.outputTable)) return false
    } else if (isDataNode(c) && !nodeOutputTable(c)) {
      return false
    }
    return true
  }

  // 试跑运行器：给定一组已校验通过的节点 id，跑一次 L→C 流转 + 落表。整链试跑与单节点试跑共用。
  function runTrial(def: FlowDef, ids: string[]): string {
    const runId = `RUN-TRIAL-${String(trialSeq++).padStart(2, '0')}`
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
    const run: RunRow = { runId, flow: def.name, state: 'L', startedAt, owner: 'admin', ruleHits: 0 }
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

  // 整链试跑：跑主链上所有可试跑节点
  function trial(def: FlowDef): string {
    if (running.value) return ''
    const ids = def.main.filter((id) => isRunnable(def, id))
    if (!ids.length) return ''
    return runTrial(def, ids)
  }

  // 单节点试跑：只跑当前节点（同样走真闭环 L→C + 落表），返回 '' 表示不可试跑或已有试跑在进行
  function trialNode(def: FlowDef, nodeId: string): string {
    if (running.value) return ''
    if (!isRunnable(def, nodeId)) return ''
    return runTrial(def, [nodeId])
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
          title: `试跑落表 · ${def.source?.name ?? cfg?.title ?? '网页抓取'}`,
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

  return { runs, runNodes, nodeStates, dataByTable, lastRunId, running, trial, trialNode }
})
