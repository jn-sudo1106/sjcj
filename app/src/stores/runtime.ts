import { reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { RunRow, RunNode, DataRow } from '../api'
import type { FlowDef } from '../views/FlowCanvas/flowModel'

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

  function trial(def: FlowDef): string {
    const ids = def.main.filter((id) => id !== 'start' && id !== 'end' && def.configs[id])
    if (!ids.length) return ''
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
        input: cfg?.collectCfg?.url ?? cfg?.inmap?.[0]?.[0] ?? '-',
        output: cfg?.collectCfg?.outputTable ?? cfg?.output?.[0]?.[0] ?? '-',
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
            generateData(def, runId)
            running.value = false
          }
        },
        (i + 1) * 600,
      )
    })
    return runId
  }

  // 落表：生成进入「数据查看」的实体数据（演示落到公告明细表 t-notice）
  function generateData(def: FlowDef, runId: string) {
    const collectId = def.main.find((id) => def.configs[id]?.collect)
    const cfg = collectId ? def.configs[collectId] : undefined
    const table = 't-notice'
    const rows: DataRow[] = [
      {
        dataId: `${runId}-001`,
        title: `试跑落表 · ${cfg?.collectCfg?.sourceName ?? '网页抓取'}`,
        summary: `来自流程「${def.name}」`,
        sourceId: cfg?.collectCfg?.configId ?? '—',
        configId: cfg?.collectCfg?.configId,
        taskId: `TK-${runId}`,
        runId,
        acceptState: 'pending',
        fileType: 'html',
        parseState: 'parsed',
      },
    ]
    dataByTable[table] = [...rows, ...(dataByTable[table] ?? [])]
  }

  return { runs, runNodes, nodeStates, dataByTable, lastRunId, running, trial }
})
