import { expect, it, vi } from 'vitest'
import { fetchPromptList } from '@/api/prompt'
import { loadPromptTemplateForNode } from './promptTemplateLoader'
vi.mock('@/api/prompt', () => ({ fetchPromptList: vi.fn() }))
it('生成配置同时应用系统与用户模板，并按当前表、字段和描述替换变量', async () => {
  vi.mocked(fetchPromptList).mockResolvedValue([{ promptId: 1, nodeType: '90', nodeTypeName: '网页抓取', category: 'collect', systemPrompt: '输出表 {{output_table}}', userPromptTemplate: '需求 {{describe}}，字段 {{output_fields}}' }])
  expect(await loadPromptTemplateForNode({ promptListCategory: 'collect', promptCategory: '网页抓取', inputTableName: 'src', outputTableName: 'dst', inputFields: [], outputFields: ['title'], inputFieldOptions: [], outputFieldOptions: [{ itemCode: 'title', itemName: '标题' }], describe: '新闻' })).toBe('输出表 dst\n\n需求 新闻，字段 title')
})
it('明确选择时使用指定提示词，不按默认项替换；选择不可用返回空', async () => {
  vi.mocked(fetchPromptList).mockResolvedValue([
    { promptId: 1, nodeType: '90', nodeTypeName: '网页抓取', category: 'collect', systemPrompt: '默认提示词' },
    { promptId: 2, nodeType: '90', nodeTypeName: '网页抓取', category: 'collect', systemPrompt: '指定提示词' },
  ])
  const context = { promptListCategory: 'collect', promptCategory: '网页抓取' as const, inputTableName: '', outputTableName: '', inputFields: [], outputFields: [], inputFieldOptions: [], outputFieldOptions: [] }
  expect(await loadPromptTemplateForNode({ ...context, promptTemplateId: 2 })).toBe('指定提示词')
  expect(await loadPromptTemplateForNode({ ...context, promptTemplateId: 99 })).toBeNull()
})
