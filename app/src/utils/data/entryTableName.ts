import { pinyin } from 'pinyin-pro'

/**
 * 新建表时按名称生成物理表名：`TB_` + 名称拼音首字母（大写）。
 * 1:1 沿用旧平台 EntryTypeEdit 的 `watch form.typeName`；英文字符原样保留、一并转大写。
 * 数据中心抽屉（EntryEditorDrawer）、流程画布建表弹窗（TableEditDialog）、AI 对话建表草稿卡片共用，口径必须一致。
 */
export function tableNameFromEntryName(name: string | undefined): string {
  const letters = pinyin(name || '', { pattern: 'first', toneType: 'none', type: 'array' }).join('')
  return letters ? `TB_${letters.toUpperCase()}` : ''
}
