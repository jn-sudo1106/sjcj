<script setup lang="ts">
// 配置模板详情 —— 1:1 迁移旧 data-view `src/page/base/detail/ConfigDetail.vue`
// （TaskInst.vue 的 `handleShowConfig(configId)` → `$refs.configDetail.showModal(configId)`，
//  点表格里「配置ID」那个蓝色 tag 时打开）。
//
// 旧版行为：`queryConfigDetail(id)` 拿到配置记录后 `showDrawer(record, '配置模板')` ——
//   base-detail-drawer 渲染 `allColumns.CONFIG.columns + other`（排除 noDetail 的 action），
//   下面再挂一张 `allColumns.CONFIG.params` 的「参数列表」表（listKey='params'、rowKey='paramId'）。
//
// 说明：这里只保留**只读**的详情展示（旧组件里那点编辑/保存相关的东西 TASK_LIST 页用不到 ——
// 旧 ConfigDetail 的 loadEditInfo 是空方法、read prop 在本页也没传）。
//
// 有意偏差（都在交付说明里单列）：
//   1. 不迁 vkbeautify.xml：旧版把 `snatchConf`（抓取配置）做了 XML 缩进美化。这里长文本一律
//      原样放进 `<pre>`（只为缩进 XML 引一个依赖不划算）；其余长文本（运行策略/下载配置/正文规则/
//      结构化配置/核心参数）在原版里本来就是原样展示。
//   2. 抽屉标题「配置模板 - 详情」（旧版同样是 `标题 + ' - 详情'`）；placement/宽度对齐 Monitor 其他详情弹层。
//   3. 参数列表里的「参考值」列：旧 BaseDetail 的 defaultSlot 会把 http 链接、fileId/地址类路径渲染成
//      可点链接（依赖 apiport 9102 拼 oss 下载地址）。本页只保留 http(s) 链接可点，路径类不再拼
//      oss 地址（那串 hostname:9102 是旧平台部署参数，新平台没有）。
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { configApi } from '@/api'
import { configDetailColumns, CONFIG_PARAM_COLUMNS, type TaskColumn } from './columns'

defineOptions({ name: 'ConfigTemplateDrawer' })

const open = ref(false)
const loading = ref(false)
const configId = ref('')
const record = ref<Record<string, unknown> | null>(null)

const columns = (): TaskColumn[] => configDetailColumns()
const paramColumns = CONFIG_PARAM_COLUMNS

/** 参数行（旧 CONFIG.params 的 4 列） */
function params(): Array<Record<string, unknown>> {
  const list = record.value?.params
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : []
}

/** 详情取值：空值兜底 '—'；textArea/json 类型用 `<pre>` 原样展示 */
function display(col: TaskColumn): string {
  const value = record.value?.[col.dataIndex]
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}

async function openDrawer(id: string) {
  if (!id) return
  configId.value = id
  open.value = true
  loading.value = true
  record.value = null
  try {
    record.value = await configApi.configDetailRaw(id)
  } catch (err) {
    ElMessage.error('获取配置详情失败: ' + (err instanceof Error ? err.message : String(err)))
  } finally {
    loading.value = false
  }
}

function isLink(value: unknown): boolean {
  const s = String(value ?? '')
  return s.startsWith('http:') || s.startsWith('https:')
}

defineExpose({ open: openDrawer })
</script>

<template>
  <el-drawer
    v-model="open"
    :title="`配置模板 - 详情${configId ? '：' + configId : ''}`"
    direction="rtl"
    size="clamp(500px, 58vw, 850px)"
    class-name="rc-drawer"
  >
    <div v-loading="loading" class="ctd-body">
      <el-descriptions v-if="record" border :column="4" class="ctd-desc">
        <el-descriptions-item
          v-for="col in columns()"
          :key="col.dataIndex"
          :span="col.span ?? 2"
          :label="col.title"
        >
          <pre v-if="col.type === 'textArea' || col.type === 'json'" class="ctd-pre">{{ display(col) }}</pre>
          <span v-else>{{ display(col) }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-table v-if="record && params().length" :data="params()" border size="small" class="ctd-params">
        <el-table-column
          v-for="p in paramColumns"
          :key="p.dataIndex"
          :label="p.title"
          :prop="p.dataIndex"
        >
          <template #default="{ row }">
            <a
              v-if="isLink(row[p.dataIndex])"
              :href="String(row[p.dataIndex])"
              target="_blank"
              rel="noreferrer noopener nofollow"
              class="ctd-link"
            >{{ row[p.dataIndex] }}</a>
            <span v-else>{{ row[p.dataIndex] }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-drawer>
</template>

<style scoped>
.ctd-body {
  padding: 0 4px 16px;
}
.ctd-desc :deep(.el-descriptions__label) {
  width: 120px;
  color: var(--rc-muted, #64748b);
  font-size: 12px;
}
.ctd-desc :deep(.el-descriptions__cell) {
  padding: 4px 8px;
  font-size: 12px;
}
.ctd-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--rc-mono, monospace);
  font-size: 12px;
}
.ctd-params {
  margin-top: 15px;
}
.ctd-link {
  color: var(--rc-primary, #2563eb);
  word-break: break-all;
}
</style>
