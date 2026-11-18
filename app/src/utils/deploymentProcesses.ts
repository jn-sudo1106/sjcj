import { h } from 'vue'
import { ElMessageBox } from 'element-plus'
import { runnerManagementApi, type RunnerInstance, type RunnerWorkerProcess } from '@/api/runnerManagement'

export interface DeploymentProcessTarget { runnerId: string; directory: string }
type AffectedProcess = RunnerWorkerProcess & { runner: RunnerInstance; runtimeId: string; revision: string; enabled: boolean }
let confirmationSequence = 0

function absolutePath(root: string, value: string) {
  if (!value) throw new Error('部署目录尚未确定，请刷新部署信息后重试')
  const path = /^(?:[a-z]:[\\/]|[\\/])/i.test(value) ? value : `${root}/${value}`
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized
}
function overlaps(first: string, second: string) {
  return first === second || first.startsWith(second + '/') || second.startsWith(first + '/')
}

export async function prepareDeploymentProcesses(targets: DeploymentProcessTarget[], current: () => boolean,
  status: (text: string) => void = () => {}) {
  const cancelled = { proceed: false, stoppedCount: 0 }
  status('正在检查目标机器的运行进程…')
  const machines = await runnerManagementApi.instances()
  if (!current()) return cancelled
  const candidates = machines.filter(machine => machine.status === 'online' && targets.some(target => target.runnerId === machine.runnerId)
    && machine.workerProcesses?.length)
  if (!candidates.length) return { proceed: true, stoppedCount: 0 }
  const runtimes = await runnerManagementApi.runtimeConfigurations()
  if (!current()) return cancelled
  const affected: AffectedProcess[] = []
  for (const runner of candidates) for (const process of runner.workerProcesses || []) {
    const runtime = runtimes.find(item => item.runnerId === runner.runnerId && (item.assignmentId || item.assignment?.assignmentId) === process.assignmentId)
    const entryDirectory = process.entry && /[\\/]/.test(process.entry) ? process.entry.replace(/[\\/][^\\/]+$/, '') : ''
    const directory = process.workingDirectory || entryDirectory
      || runtime?.binding?.delivery?.installedPath || runtime?.assignment?.deliveryPath || runtime?.directoryTemplate
    if (!directory) throw new Error(`${runner.ipAddress} 的进程 ${process.pid} 尚未上报运行目录，请在运行实例中确认后重试`)
    if (!targets.some(target => target.runnerId === runner.runnerId
      && overlaps(absolutePath(runner.installDirectory, directory), absolutePath(runner.installDirectory, target.directory)))) continue
    affected.push({ ...process, runner, runtimeId: runtime?.runtimeId || '', revision: runtime?.revision || '', enabled: !!runtime?.assignment?.enabled })
  }
  if (!affected.length) return { proceed: true, stoppedCount: 0 }
  let closeProcesses = true
  const name = `deployment-process-choice-${++confirmationSequence}`
  try {
    await ElMessageBox.confirm(h('div', [
      h('p', `目标部署目录中有 ${affected.length} 个运行进程，是否关闭后提交？关闭会中断这些程序正在执行的任务。`),
      h('ul', { style: { maxHeight: '180px', overflow: 'auto', paddingLeft: '20px' } }, affected.map(item =>
        h('li', { style: { overflowWrap: 'anywhere' } }, `${item.runner.ipAddress} · ${item.entry || item.queue} · PID ${item.pid}`))),
      h('p', [h('label', [h('input', { type: 'radio', name, value: 'stop', checked: true, onChange: () => { closeProcesses = true } }), ' 关闭相关进程后提交'])]),
      h('p', [h('label', [h('input', { type: 'radio', name, value: 'keep', onChange: () => { closeProcesses = false } }), ' 保持运行，直接提交'])]),
      h('p', '保持运行可能导致 EXE 或依赖文件无法更新。关闭后请在部署完成时到“运行实例”启动程序。'),
    ]), '部署前确认', { type: 'warning', confirmButtonText: '提交部署任务', cancelButtonText: '取消', closeOnClickModal: false })
  } catch (action) {
    if (action === 'cancel' || action === 'close') return cancelled
    throw action
  }
  if (!current()) return cancelled
  if (!closeProcesses) return { proceed: true, stoppedCount: 0 }
  const programs = [...new Map(affected.map(item => [`${item.runner.runnerId}:${item.assignmentId}`, item])).values()]
  if (programs.some(item => !item.runtimeId || !item.revision)) throw new Error('部分进程没有可操作的运行实例，请先在“运行实例”中手动关闭后再提交')
  status('正在关闭相关进程，等待 Runner 确认…')
  let requested = 0
  try {
    for (const program of programs) {
      if (!current()) return cancelled
      if (program.enabled) { await runnerManagementApi.stopRuntimeProgram(program.runtimeId, program.revision); requested++ }
    }
  } catch (error) {
    throw new Error(`关闭进程失败，未提交部署任务：${error instanceof Error ? error.message : String(error)}${requested ? '；部分关闭指令已提交，请到运行实例查看状态' : ''}`)
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!current()) return cancelled
    const fresh = await runnerManagementApi.instances()
    if (!current()) return cancelled
    if (programs.some(program => !fresh.some(machine => machine.runnerId === program.runner.runnerId && machine.status === 'online' && machine.workerProcesses != null))) {
      throw new Error('关闭指令已提交，但目标机器离线或进程状态尚未上报，未提交部署任务，请到运行实例查看状态')
    }
    if (programs.every(program => !fresh.find(machine => machine.runnerId === program.runner.runnerId)!.workerProcesses!
      .some(process => process.assignmentId === program.assignmentId))) return { proceed: true, stoppedCount: affected.length }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error('关闭指令已提交，但尚未确认进程退出，未提交部署任务，请到运行实例查看状态')
}
