<script setup lang="ts">
// 实例列表。
//
// 列：实例名称（含 #ID 与「被 N 个源设为默认」）/ 覆盖网站 / 配置摘要 / 覆盖源数 / 最近修改 / 操作。
// 草稿行（C12：只记目标范围意图、不建立绑定）显示「草稿 · 不可执行」徽标与目标范围源数，
// 不能作为有效执行配置——这是 1110 复核 F01/AC32 的硬要求。
// 表格沿用项目通用 `rc-data-table`（与采集资产、系统设置等页面一致），不再自绘表头。
import type { InstanceRow } from '@/api/types/flowCenterCenter'

withDefaults(defineProps<{
  rows: InstanceRow[]
  total: number
  loading?: boolean
  page?: number
  pageSize?: number
  templateName?: string
  /** 覆盖网站列：后端 C02 未就绪时传 false 隐藏该列（全部流程视图） */
  showSites?: boolean
  error?: string
}>(), {
  loading: false,
  page: 1,
  pageSize: 20,
  templateName: '',
  showSites: true,
  error: '',
})

const emit = defineEmits<{
  'bind-source': [row: InstanceRow]
  diff: [row: InstanceRow]
  edit: [row: InstanceRow]
  more: [row: InstanceRow, action: string]
  'page-change': [page: number]
  retry: []
}>()

const moreActions = [
  { key: 'save-as-template', label: '另存为新模板' },
  { key: 'copy-instance', label: '复制为新实例' },
  { key: 'open-sources', label: '关联到源' },
  { key: 'delete', label: '删除流程' },
]

function pageCount(total: number, size: number) {
  return Math.max(1, Math.ceil(total / size))
}

function siteText(row: InstanceRow) {
  return row.sites[0] || '—'
}

function extraSites(row: InstanceRow) {
  return Math.max(0, row.sites.length - 1)
}
</script>

<template>
  <div class="fc-table-card" data-testid="flow-center-instances">
    <div class="fc-table-head">
      流程实例 <b>{{ total.toLocaleString('zh-CN') }}</b>
      <el-tag size="small" type="info" effect="plain">当前账号可见</el-tag>
      <span class="fc-spacer"></span>
      <span class="fc-sub">{{ loading ? '加载中…' : '排序：最近修改' }}</span>
    </div>
    <div v-if="error" class="fc-error" data-testid="flow-center-instances-error">
      <span>实例列表加载失败：{{ error }}</span>
      <el-button link type="primary" @click="emit('retry')">重试</el-button>
    </div>
    <div v-else class="fc-table-scroll">
      <table class="rc-data-table fc-instance-table">
        <thead>
          <tr>
            <th class="fc-col-name">实例名称</th>
            <th v-if="showSites" class="fc-col-site">覆盖网站</th>
            <th class="fc-col-summary">配置摘要</th>
            <th class="fc-col-count">覆盖源数</th>
            <th class="fc-col-updated">最近修改</th>
            <th class="fc-col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" :data-testid="`flow-instance-${row.id}`">
            <td>
              <div class="fc-iname">
                <span class="fc-instance-name" :title="row.name">{{ row.name }}</span>
                <el-tag v-if="row.draft" size="small" type="warning" effect="plain">草稿 · 不可执行</el-tag>
                <el-tag v-else-if="row.disabled" size="small" type="info" effect="plain">已停用</el-tag>
              </div>
              <div v-if="row.draft" class="fc-isub">#{{ row.id }} · 目标范围 {{ row.scopeIntentCount ?? 0 }} 个源，未绑定</div>
              <div v-else class="fc-isub">
                #{{ row.id }}<template v-if="row.defaultSourceCount"> · 被 <b>{{ row.defaultSourceCount }}</b> 个源设为默认</template>
                <template v-if="row.maintainer"> · {{ row.maintainer }} 维护</template>
              </div>
            </td>
            <td v-if="showSites">
              <span>{{ siteText(row) }}</span>
              <div v-if="extraSites(row)" class="fc-isub">+{{ extraSites(row) }} 个网站</div>
            </td>
            <td>
              <div class="fc-cfgsum" :title="row.summary.join(' → ')">
                <template v-for="(part, index) in row.summary" :key="`${row.id}-${index}`">
                  <span v-if="index > 0" class="arw" aria-hidden="true">→</span>
                  <em v-if="/^(脚本|仅归档|无输出表|待补齐)/.test(part)">{{ part }}</em>
                  <span v-else>{{ part }}</span>
                </template>
              </div>
            </td>
            <td class="fc-num r"><b>{{ row.draft ? '—' : row.sourceCount }}</b></td>
            <td class="fc-num">{{ row.updatedAt || '—' }}</td>
            <td>
              <div class="fc-actions">
                <template v-if="row.draft">
                  <el-button link type="primary" data-testid="instance-go-config" @click="emit('edit', row)">补齐配置</el-button>
                  <el-button link type="primary" data-testid="instance-bind-draft" @click="emit('bind-source', row)">关联源</el-button>
                </template>
                <template v-else>
                  <el-button link type="primary" data-testid="instance-bind-source" @click="emit('bind-source', row)">绑定源</el-button>
                  <el-button link type="primary" data-testid="instance-diff" @click="emit('diff', row)">配置差异</el-button>
                  <el-button link type="primary" data-testid="instance-edit" @click="emit('edit', row)">编辑</el-button>
                </template>
                <el-dropdown trigger="click" @command="(action: string) => emit('more', row, action)">
                  <el-button link type="primary" aria-label="更多操作">更多</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-for="item in moreActions" :key="item.key" :command="item.key">{{ item.label }}</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && !rows.length">
            <td :colspan="showSites ? 6 : 5">
              <div class="fc-empty-cell">
                <b>这个模板下还没有实例</b>
                <span>点右上角「从模板新建」，按网站与源范围建一个实例。</span>
              </div>
            </td>
          </tr>
          <tr v-if="loading && !rows.length">
            <td :colspan="showSites ? 6 : 5"><div class="fc-empty-cell">加载中…</div></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="fc-foot">
      共 {{ total.toLocaleString('zh-CN') }} 条 · 第 {{ page }}/{{ pageCount(total, pageSize) }} 页
      <span class="fc-spacer"></span>
      <span class="pager">
        <el-button size="small" :disabled="page <= 1" @click="emit('page-change', page - 1)">上一页</el-button>
        <el-button size="small" :disabled="page >= pageCount(total, pageSize)" @click="emit('page-change', page + 1)">下一页</el-button>
      </span>
    </div>
  </div>
</template>