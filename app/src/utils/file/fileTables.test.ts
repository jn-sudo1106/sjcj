import { describe, expect, it, vi } from 'vitest'
import { isFileLikeTable, loadFlowFileTables, mergeFileTableCandidates, pickTableWithFiles } from './fileTables'

// 217 上 6200037 pdf文件表（照 133 的 2101765 建）的真实列定义
const pdfTable = {
  tableId: '6200037',
  fields: [
    { columnName: 'K1', desc: '文件名' }, { columnName: 'K2', desc: '文件链接' }, { columnName: 'K3', desc: '文件路径' },
    { columnName: 'K4', desc: '文件大小' }, { columnName: 'K5', desc: '文件md5' },
  ],
}

describe('isFileLikeTable', () => {
  it('K3 是路径、K5 是 md5 的表认作文件表（pdf文件表 / file_resource 同构）', () => {
    expect(isFileLikeTable(pdfTable)).toBe(true)
    // 133 njcb_file_resource 的 K3 叫「保存文件路径」
    expect(isFileLikeTable({ tableId: 'x', fields: [{ columnName: 'K3', desc: '保存文件路径' }, { columnName: 'K5', desc: '文件MD5' }] })).toBe(true)
  })

  it('列位不对的表不算——文件视图按固定 K 列渲染，塞进来会整片错位', () => {
    // 公告表 6200036：K4 才是「正文路径」，K5 是发布日期
    expect(isFileLikeTable({ tableId: '6200036', fields: [{ columnName: 'K4', desc: '正文路径' }, { columnName: 'K5', desc: '发布日期' }] })).toBe(false)
    expect(isFileLikeTable({ tableId: 'empty', fields: [] })).toBe(false)
    expect(isFileLikeTable({ tableId: 'nofields' })).toBe(false)
  })
})

describe('loadFlowFileTables', () => {
  it('只留下结构是文件表的，去重、跳过空 ID 和取失败的表', async () => {
    const loadMeta = vi.fn(async (id: string) => {
      if (id === 'boom') throw new Error('500')
      if (id === '6200036') return { tableId: id, fields: [{ columnName: 'K4', desc: '正文路径' }] }
      return { ...pdfTable, tableId: id }
    })
    const tables = await loadFlowFileTables(['6200036', '6200037', '6200037', '', '0', undefined, 'boom'], loadMeta)
    expect(tables.map((t) => t.tableId)).toEqual(['6200037'])
    expect(loadMeta).toHaveBeenCalledTimes(3)
  })
})

describe('mergeFileTableCandidates', () => {
  it('流程产出的文件表排前面，file_resource 表随后，按 tableId 去重', () => {
    const merged = mergeFileTableCandidates(
      [{ tableId: '6200037' }, { tableId: 'fr-1' }],
      [{ tableId: 'fr-1' }, { tableId: 'fr-2' }],
    )
    expect(merged.map((t) => t.tableId)).toEqual(['6200037', 'fr-1', 'fr-2'])
  })
})

describe('pickTableWithFiles', () => {
  it('选第一张有文件的表，命中后不再探测后面的', async () => {
    const hasFiles = vi.fn(async (t: { tableId: string }) => t.tableId === 'b')
    const picked = await pickTableWithFiles([{ tableId: 'a' }, { tableId: 'b' }, { tableId: 'c' }], hasFiles)
    expect(picked?.tableId).toBe('b')
    expect(hasFiles).toHaveBeenCalledTimes(2)
  })

  it('都没有文件或探测失败时退回第一张', async () => {
    const picked = await pickTableWithFiles([{ tableId: 'a' }, { tableId: 'b' }], async (t) => {
      if (t.tableId === 'a') throw new Error('500')
      return false
    })
    expect(picked?.tableId).toBe('a')
  })

  it('只有一张候选时不探测', async () => {
    const hasFiles = vi.fn(async () => true)
    expect((await pickTableWithFiles([{ tableId: 'only' }], hasFiles))?.tableId).toBe('only')
    expect(hasFiles).not.toHaveBeenCalled()
    expect(await pickTableWithFiles([], hasFiles)).toBeUndefined()
  })
})
