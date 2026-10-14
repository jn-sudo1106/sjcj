<script setup lang="ts">
// 列驱动的详情抽屉 —— 1:1 迁移旧 data-view `src/page/config/modules/BaseDetail.vue`。
//
// 旧形态：左侧 `a-drawer` + 顶部「关闭本页」按钮 + `a-descriptions size="small" :column="4" bordered`
// 逐列渲染 `record[col.dataIndex]`，尾部再挂两张可选表格（主列表 + 子表列表）。
// 同一个组件被「指标详情」「源详情」「数据表详情」三处复用（只换 cols / listCols / subCols）。
//
// 旧版逐列渲染的三类特殊口径，全部照搬：
//   · dataIndex === 'isDelete' → 全局过滤器 enableFilter（1→是[1] / 0→否[0]）
//   · dataIndex === 'state'    → 全局过滤器 stateFilter（C→正常 / E→出错 / L→处理中 …）
//   · type === 'textArea'      → textarea；带 `save` 时出现「保存」按钮（旧 SOURCE.remark 就是这个形态）
//   · col.fun                  → 自定义取值函数
//   · col.url                  → 值本身就是外链，渲染成新窗口打开的 <a>
//   · col.href                 → 值是 URL 模板（`$VAL$` 占位），渲染成新窗口打开的 <a>
//
// 有意偏差（与 indicatorDataset/DatasetDetailDrawer 同一批口径）：
//   1. 旧 BaseDetail 默认 placement='left'（左侧抽屉）。新平台约定「详情类弹层统一右侧 el-drawer」，
//      这里放右侧；宽度用 CSS clamp 精确复刻旧版算法（500 下限 / 58vw / 850 上限）。
//   2. 旧版 `col.link` 会走 `$multiTab.open(link.replace('$VAL$', id))` 打开**旧平台的标签页**
//      （/source/source-list、/inst/task-list、/inst/file-list、/config/entry-type …）。新平台没有
//      这些路由，且旧行为本身只是"打开相关列表页、不带筛选"——无法 1:1 映射，所以这里按纯文本展示，
//      并把目标路径挂进 title 属性（hover 能看到旧目标），需要真跳转时再指定新路由。
//   3. 旧版默认分支直接渲染 `record[dataIndex]`（空值就是一片空白），这里统一兜底成 '—'。
//   4. 嵌套列表里判定「这是不是一个 OSS 路径」时，旧版用 `row.itemCode`（如 k9_path / k3_minio）；
//      新平台 `dataApi.rowDetail` 的适配层只保留 itemId/columnName/itemName/value（itemCode 被丢掉），
//      所以这里 itemCode 取不到时退回 columnName 再判。OSS 链接改用同源的 `ossPublicUrl`
//      （旧版是 `http://<hostname>:9102/api/oss/download?fileId=`，端口 9102 与新项目约定一致）。
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { ColumnDef } from './types'
import { dash, enableText, stateText } from './display'
import { ossPublicUrl } from '@/utils/ossFile'

defineOptions({ name: 'ColumnDetailDrawer' })

withDefaults(defineProps<{
  cols: ColumnDef[]
  /** 主列表：取 record[listKey] 渲染成表格 */
  listCols?: ColumnDef[]
  listKey?: string
  listTitle?: string
  listRowKey?: string
  /** 子表列表：取 record[subKey] 渲染成若干张表格 */
  subKey?: string
  subCols?: ColumnDef[]
}>(), {
  listCols: () => [],
  listKey: undefined,
  listTitle: undefined,
  listRowKey: undefined,
  subKey: undefined,
  subCols: () => [],
})

const emit = defineEmits<{ (e: 'save', record: Record<string, unknown>): void }>()

const visible = ref(false)
const title = ref<string>('详情')
const record = ref<Record<string, unknown>>({})
/** textArea + save 的进行中/已完成标记（旧版 savingKey / savedKey） */
const savingKey = ref('')
const savedKey = ref('')

function open(data: Record<string, unknown>, name?: string) {
  record.value = { ...data }
  title.value = name ? `${name} - 详情` : '详情'
  savingKey.value = ''
  savedKey.value = ''
  visible.value = true
}

function close() {
  visible.value = false
}

/** 主/子列表的取值：新平台的动态行可能是扁平字段，也可能挂在 values 上 */
function cell(row: Record<string, unknown> | undefined, dataIndex: string): unknown {
  if (!row) return undefined
  if (dataIndex in row) return row[dataIndex]
  const values = row.values as Record<string, unknown> | undefined
  return values?.[dataIndex]
}

/** 旧版 buildHref：`$VAL$` 占位替换成当前值 */
function buildHref(tpl: string, value: unknown): string {
  return tpl.replace('$VAL$', String(value ?? ''))
}

async function saveItem(col: ColumnDef) {
  if (!col.save || savingKey.value) return
  savingKey.value = col.dataIndex
  try {
    await col.save(record.value)
    ElMessage.success('保存成功')
    savedKey.value = col.dataIndex
    emit('save', record.value)
    setTimeout(() => {
      if (savedKey.value === col.dataIndex) savedKey.value = ''
    }, 1500)
  } catch (err) {
    ElMessage.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    savingKey.value = ''
  }
}

/** 嵌套列表里的值：http(s) → 原样外链；OSS 路径（/ 开头且是路径/地址/图片类字段）→ 9102 下载地址 */
function listCellLink(row: Record<string, unknown> | undefined): { text: string; href?: string } {
  const text = String(cell(row, 'value') ?? '')
  if (!text) return { text: '' }
  if (text.startsWith('http:') || text.startsWith('https:')) return { text, href: text }
  const isOssPath = text.startsWith('/')
  if (!isOssPath) return { text }
  const code = String(cell(row, 'itemCode') ?? cell(row, 'columnName') ?? '')
  const name = String(cell(row, 'itemName') ?? '')
  const byCode = code.includes('path') || code.includes('minio')
  const byName = ['地址', '路径', '图片'].some((kw) => name.includes(kw))
  return byCode || byName ? { text, href: ossPublicUrl(text) } : { text }
}

defineExpose({ open })
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="title"
    direction="rtl"
    size="clamp(500px, 58vw, 850px)"
    class-name="rc-drawer cdd-drawer"
  >
    <el-button @click="close">关闭本页</el-button>

    <el-descriptions :column="4" border size="small" style="margin-top: 12px">
      <el-descriptions-item v-for="col in cols" :key="col.dataIndex" :label="col.title" :span="col.span">
        <!-- href：URL 模板 -->
        <a
          v-if="col.href"
          :href="buildHref(col.href, record[col.dataIndex])"
          target="_blank"
          rel="noreferrer noopener nofollow"
          class="cdd-break"
        >{{ dash(record[col.dataIndex]) }}</a>

        <!-- url：值本身就是外链 -->
        <a
          v-else-if="col.url"
          :href="String(record[col.dataIndex] ?? '')"
          target="_blank"
          rel="noreferrer noopener nofollow"
          class="cdd-break"
        >{{ dash(record[col.dataIndex]) }}</a>

        <!-- link：旧平台 `$multiTab.open` 的站内跳转；新平台无对应路由 → 文本 + hover 提示旧目标 -->
        <span v-else-if="col.link" :title="`旧平台跳转目标：${buildHref(col.link, record[col.dataIndex])}`">
          {{ dash(record[col.dataIndex]) }}
        </span>

        <!-- textArea（带 save 时出现保存按钮） -->
        <div v-else-if="col.type === 'textArea'" class="cdd-textarea">
          <el-input
            :model-value="String(record[col.dataIndex] ?? '')"
            type="textarea"
            :autosize="{ minRows: col.minRows || 2, maxRows: col.maxRows || 8 }"
            :placeholder="record[col.dataIndex] ? '' : (col.placeholder || '无')"
            :readonly="!col.save"
            @update:model-value="(v: string) => (record[col.dataIndex] = v)"
          />
          <span v-if="col.save" class="cdd-textarea-btn">
            <el-button
              type="primary"
              size="small"
              :loading="savingKey === col.dataIndex"
              :disabled="savedKey === col.dataIndex"
              @click="saveItem(col)"
            >{{ savedKey === col.dataIndex ? '已保存' : (savingKey === col.dataIndex ? '保存中' : '保存') }}</el-button>
          </span>
        </div>

        <span v-else-if="col.dataIndex === 'isDelete'">{{ enableText(record[col.dataIndex]) }}</span>
        <span v-else-if="col.dataIndex === 'state'">{{ stateText(record[col.dataIndex]) }}</span>
        <span v-else-if="col.fun">{{ dash(col.fun(record[col.dataIndex])) }}</span>
        <span v-else>{{ dash(record[col.dataIndex]) }}</span>
      </el-descriptions-item>
    </el-descriptions>

    <!-- 主列表（旧 BaseDetail 的 listKey / listCols） -->
    <el-table
      v-if="listKey && Array.isArray(record[listKey]) && (record[listKey] as unknown[]).length"
      :data="record[listKey] as Record<string, unknown>[]"
      size="small"
      border
      :row-key="(row: Record<string, unknown>) => String(cell(row, listRowKey || '') ?? '')"
      style="margin-top: 15px"
    >
      <el-table-column
        v-for="col in listCols"
        :key="col.dataIndex"
        :label="col.title"
        :prop="col.dataIndex"
        :width="col.minWidth ? undefined : col.width"
        :min-width="col.minWidth"
      >
        <template #default="{ row }">
          <template v-if="col.dataIndex === 'value'">
            <a
              v-if="listCellLink(row).href"
              :href="listCellLink(row).href"
              target="_blank"
              rel="noopener noreferrer"
            >{{ listCellLink(row).text }}</a>
            <span v-else>{{ listCellLink(row).text }}</span>
          </template>
          <span v-else>{{ dash(cell(row, col.dataIndex)) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 子表列表（旧 subKey / subCols；每个子行自带 showItems） -->
    <div v-if="subKey && Array.isArray(record[subKey]) && (record[subKey] as unknown[]).length">
      <div v-if="record.subsCnt" class="cdd-subs-tip">
        💡 [以下为子表数据] 本页展示子数据:
        <span class="cdd-subs-count">[{{ (record[subKey] as unknown[]).length }} / {{ record.subsCnt }}]</span>条
      </div>
      <div v-for="(sub, si) in (record[subKey] as Record<string, unknown>[])" :key="si" class="cdd-sub">
        <div class="cdd-sub-title">
          [子表] - [{{ sub.entryTypeId }}-{{ sub.entryTypeName }}] - 子表ID: [{{ sub.entryId }}]
        </div>
        <el-table
          :data="(sub[listKey || ''] as Record<string, unknown>[]) ?? []"
          size="small"
          border
          :row-key="(row: Record<string, unknown>) => String(cell(row, listRowKey || '') ?? '')"
        >
          <el-table-column
            v-for="col in subCols"
            :key="col.dataIndex"
            :label="col.title"
            :prop="col.dataIndex"
            :width="col.minWidth ? undefined : col.width"
            :min-width="col.minWidth"
          >
            <template #default="{ row }">
              <template v-if="col.dataIndex === 'value'">
                <a
                  v-if="listCellLink(row).href"
                  :href="listCellLink(row).href"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ listCellLink(row).text }}</a>
                <span v-else>{{ listCellLink(row).text }}</span>
              </template>
              <span v-else>{{ dash(cell(row, col.dataIndex)) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.cdd-break {
  word-break: break-all;
}
.cdd-textarea {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.cdd-textarea-btn {
  flex-shrink: 0;
  padding-top: 2px;
}
.cdd-subs-tip {
  padding-top: 20px;
  padding-left: 5px;
}
.cdd-subs-count {
  color: #f56c6c;
}
.cdd-sub {
  font-size: 11px;
}
.cdd-sub-title {
  margin-top: 15px;
  font-weight: 600;
}
</style>
