<script setup lang="ts">
// SQL 模板配置（旧 ai-chat-view「模板配置 → sql模板配置」，src/demo/SqlTempConfig.vue）。
// 页面只提供三份声明：列 / 表单字段 / 接口，列表结构与交互由 components/templateConfig 的通用层承担。
// 列标题与表单项标题都按旧页面原文（同一字段在列表叫「通过条件」、在编辑弹窗叫「接受条件」，
// 是旧平台自身的用词不一致，迁移期不合并口径，等旧平台下线后统一）。
import { sqlTemplateApi } from '@/api/templateConfig'
import TemplateListPage from '@/components/templateConfig/TemplateListPage.vue'
import type { TemplateColumn, TemplateField } from '@/components/templateConfig/types'

defineOptions({ name: 'SqlTemplatePage' })

const columns: TemplateColumn[] = [
  { prop: 'id', label: 'id', width: 60 },
  { prop: 'name', label: '模板名称', width: 140, ellipsis: true },
  { prop: 'content', label: '模板内容', minWidth: 260, align: 'left', type: 'mono', ellipsis: true },
  { prop: 'receiveRule', label: '通过条件', minWidth: 200, align: 'left', type: 'mono', ellipsis: true },
  { prop: 'rejectRule', label: '拒绝条件', minWidth: 200, align: 'left', type: 'mono', ellipsis: true },
  { prop: 'selectRule', label: 'select内容校验', minWidth: 200, align: 'left', type: 'mono', ellipsis: true },
  { prop: 'fromTableRule', label: 'table内容校验', minWidth: 200, align: 'left', type: 'mono', ellipsis: true },
  { prop: 'whereRule', label: 'where内容校验', minWidth: 200, align: 'left', type: 'mono', ellipsis: true },
  { prop: 'groupByRule', label: 'group by内容校验', minWidth: 200, align: 'left', type: 'mono', ellipsis: true },
  { prop: 'status', label: '状态', width: 96, type: 'status' },
  { prop: 'createTime', label: '创建时间', width: 150 },
  { prop: 'updateTime', label: '修改时间', width: 150 },
]

const fields: TemplateField[] = [
  { prop: 'name', label: 'sql模板名称', required: true },
  { prop: 'content', label: '模板内容', type: 'textarea', rows: 6 },
  { prop: 'receiveRule', label: '接受条件', type: 'textarea' },
  { prop: 'rejectRule', label: '拒绝条件', type: 'textarea' },
  { prop: 'selectRule', label: 'select匹配表达式', type: 'textarea' },
  { prop: 'fromTableRule', label: 'table匹配表达式', type: 'textarea' },
  { prop: 'whereRule', label: 'where匹配表达式', type: 'textarea' },
  { prop: 'groupByRule', label: '分组匹配表达式', type: 'textarea' },
  {
    prop: 'status',
    label: '状态',
    type: 'radio',
    options: [
      { label: '启用', value: '0' },
      { label: '禁用', value: '1' },
    ],
  },
]
</script>

<template>
  <TemplateListPage
    :columns="columns"
    :fields="fields"
    :api="sqlTemplateApi"
    add-title="新增sql模板"
    edit-title="编辑sql模板"
    search-label="模板名称"
    search-placeholder="模板名称"
    :defaults="{ status: '0' }"
  />
</template>
