// 模板配置通用 CRUD 层的 UI 契约类型（1013 迁入 SQL 模板配置时抽出）。
//
// 「模板配置」下的 8 个旧模块（sql 模板 / 表模板 / 自动补全 / 问句改写 / 数据索引同步 /
// 数据字典 / 提示词 / 分词）页面结构是同一套：名称模糊查询 + 分页表 + 新增/编辑弹窗 + 启停/复制。
// 所以列表页与编辑弹窗做成 schema 驱动：模块只声明「列 + 字段 + 接口」，不再各写一份表格与表单。
// 接口面见 api/templateConfig.ts 的 createTemplateCrudApi。

import type { TemplateCrudApi, TemplateRow } from '@/api/types/template'
import type { Ack } from '@/api/types/common'

/** 列渲染方式：默认按文本；status 渲染成启用/禁用滑动开关；mono 用等宽字体（SQL / 表达式列） */
export type TemplateColumnType = 'text' | 'status' | 'mono'

export interface TemplateColumn {
  prop: string
  label: string
  width?: string | number
  minWidth?: string | number
  align?: 'left' | 'center' | 'right'
  /** 超长省略 + 悬浮看全文（旧表里模板内容、校验表达式都是长串） */
  ellipsis?: boolean
  type?: TemplateColumnType
}

/** 编辑弹窗字段控件类型；旧平台清一色是输入框和多行文本域，select/radio 留给后续模块 */
export type TemplateFieldType = 'input' | 'textarea' | 'select' | 'radio'

export interface TemplateField {
  prop: string
  label: string
  type?: TemplateFieldType
  /** textarea 行数，默认 3 */
  rows?: number
  placeholder?: string
  /** 必填：提交前拦截（旧平台没有前端校验，空名称也能存进库，这里按缺陷修正） */
  required?: boolean
  options?: { label: string; value: string }[]
  /** 字段下方的灰字说明 */
  tip?: string
}

/**
 * 列表页需要的接口面：分页 + 保存必需，启停/复制按模块能力缺省。
 *
 * remove 是通用列表页认识的**行删除**能力（按 id 发 POST {module}/delete，与选表规则 / 实体改写 /
 * sql 模板的后端形态一致），所以只在这里声明、不进 api/types/template.ts 的 TemplateCrudApi
 * ——那边已有模块的删除签名不统一（question-dic 是 remove(row)），基接口放不下。
 * 后端没有 /delete 的模块不给 api 加 remove，列表页也就不画删除按钮。
 */
export type TemplateListApi = TemplateCrudApi<TemplateRow> & {
  remove?(id: number): Promise<Ack>
}
