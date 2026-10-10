import { describe, expect, it } from 'vitest'
import { applyPromptTemplate, type PromptTemplateContext } from './promptTemplate'
import type { RuleFieldOption } from '@/api'

const OPTIONS: RuleFieldOption[] = [
  { itemCode: 'sku_id', itemName: '商品ID' },
  { itemCode: 'sku_name', itemName: '商品名称' },
]

function context(overrides: Partial<PromptTemplateContext> = {}): PromptTemplateContext {
  return {
    inputTableName: 'sense_data.TB_JD_SKU_BASE',
    outputTableName: 'sense_data.TB_PDF_RESULT',
    inputFields: ['sku_id'],
    outputFields: ['sku_name'],
    inputFieldOptions: OPTIONS,
    outputFieldOptions: OPTIONS,
    ...overrides,
  }
}

describe('系统提示词模板替换', () => {
  it('替换 provider_code / model / describe 三个变量', () => {
    const text = applyPromptTemplate(
      'providerCode为{{provider_code}}，model为{{model}}，describe为{{describe}}，出参={{output_pair}}',
      context({ providerCode: 'DeepSeek', model: 'deepseek-chat', describe: '抽取合同金额' }),
    )
    expect(text).toBe('providerCode为DeepSeek，model为deepseek-chat，describe为抽取合同金额，出参=商品名称:sku_name')
  })

  it('三个变量缺省时替换成空串，不留花括号', () => {
    const text = applyPromptTemplate('[{{provider_code}}|{{model}}|{{describe}}]', context())
    expect(text).toBe('[||]')
  })

  it('只认花括号：正文里的 model / describe 裸词不被改动', () => {
    const text = applyPromptTemplate(
      'model 与 describe 是参数名，只有 {{model}} 会被替换',
      context({ model: 'deepseek-chat', describe: '抽取金额' }),
    )
    expect(text).toBe('model 与 describe 是参数名，只有 deepseek-chat 会被替换')
  })

  it('描述里的 $ 与反斜杠按原文写入，不会被当成替换模式', () => {
    const text = applyPromptTemplate('{{describe}}', context({ describe: '金额 $100 \\ 元' }))
    expect(text).toBe('金额 $100 \\ 元')
  })
})
