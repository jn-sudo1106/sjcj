import { expect, it } from 'vitest'
import type { DataRow } from '@/api'
import { codeTargetForNode, codeTargetsForRows } from './codeConfigTargets'
const row = (dataId: string, sourceId: string) => ({ dataId, sourceId }) as DataRow
it('节点代码绑定真实步骤与当前流程版本，不使用步骤 configId', () => {
  expect(codeTargetForNode('7', '50', '2', '99')).toEqual({ sourceId: '7', flowId: '50', stepId: '2', ver: '99' })
  expect(() => codeTargetForNode('7', '50', 'web-new')).toThrow('先保存当前步骤')
})
it('数据按所属源分组，ID 保持字符串；不把当前步骤当成后继', () => {
  expect(codeTargetsForRows([row('9223372036854775806', '7'), row('902', '8')], ['9223372036854775806', '902'], '11')).toEqual([
    { sourceId: '7', entryTypeId: 11, entryIds: ['9223372036854775806'] },
    { sourceId: '8', entryTypeId: 11, entryIds: ['902'] },
  ])
})
it('节点输入数据生成指定节点，输出数据生成匹配后续，均保持当前流程', () => {
  const rows = [row('901', '7')]
  expect(codeTargetsForRows(rows, ['901'], '11', '7', { flowId: '51', ver: '99', stepId: '2' })[0]).toEqual({ sourceId: '7', flowId: '51', ver: '99', stepId: '2', entryTypeId: 11, entryIds: ['901'] })
  expect(codeTargetsForRows(rows, ['901'], '12', '7', { flowId: '51' })[0]).not.toHaveProperty('stepId')
})
it('归属不明、跨源、已不在当前列表和无表的数据不能发送', () => {
  expect(() => codeTargetsForRows([row('901', '')], ['901'], '11')).toThrow('缺少有效来源')
  expect(() => codeTargetsForRows([row('901', '8')], ['901'], '11', '7', { flowId: '50' })).toThrow('不属于当前源')
  expect(() => codeTargetsForRows([], ['901'], '11')).toThrow('已不在当前列表')
  expect(() => codeTargetsForRows([], ['901'], 'tb_news')).toThrow('entryTypeId')
})
