<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import {
  CK_DEFAULT_VERSION_COLUMN, CK_ENGINES, ES_DYNAMICS, ES_FIELD_TYPES, ES_PARTITIONS,
  autoEsIndexName, dedupColumns, isEsIndexNameValid, sinkColumnChoices, sinkPreviewLines,
  type SyncColumnMap, type SyncSinkOptions,
} from '@/api/dataSync'

const props = defineProps<{
  modelValue: SyncSinkOptions | null
  databaseType: number
  columns: SyncColumnMap[]
  targetSchema: string
  targetTable: string
  /** 编辑已存在的任务：建表产物不会作用于已建好的表，需要提示出来 */
  tableExists?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [SyncSinkOptions | null] }>()

// 面板持有可编辑副本，只在挂载时取一次种子值：嵌套字段直接 v-model 修改，深监听把结果回抛给宿主。
// 宿主改 modelValue 不再往回灌，否则 emit → 宿主赋值 → 监听回灌 → 再 emit 会无限循环；
// 需要重置（切目标端类型、重新回显）时由宿主用 :key 让本组件重建。
function seed(): SyncSinkOptions {
  const saved = props.modelValue ? JSON.parse(JSON.stringify(props.modelValue)) as SyncSinkOptions : {}
  return { ck: null, es: null, ...saved }
}
const options = reactive<SyncSinkOptions>(seed())

watch(options, () => emit('update:modelValue', { ck: options.ck ?? null, es: options.es ?? null }), { deep: true })

const isCk = computed(() => options.ck !== null)
const choices = computed(() => sinkColumnChoices(props.columns))
const dedup = computed(() => dedupColumns(props.columns))
const preview = computed(() => sinkPreviewLines(options, props.databaseType,
  props.targetSchema, props.targetTable, props.columns).join('\n'))

// CK
const ck = computed(() => options.ck)
const needsVersionColumn = computed(() => ck.value?.engine === 'ReplacingMergeTree')
const orderByHint = computed(() => !ck.value?.orderByColumns?.length && !dedup.value.length
  ? '未勾选去重列，ClickHouse 建表会失败' : '')

// ES
const es = computed(() => options.es)
const autoIndex = computed(() => autoEsIndexName(props.targetSchema, props.targetTable))
const indexInvalid = computed(() => !!es.value?.index?.trim() && !isEsIndexNameValid(es.value.index))
const partitionLabels: Record<string, string> = {
  none: '不分区', day: '按天', month: '按月', year: '按年',
}

function addOverride() {
  es.value?.fieldOverrides.push({ column: '', type: 'keyword', keyword: true, format: '' })
}
</script>

<template>
  <section v-if="ck || es" class="sink-panel">
    <el-divider content-position="left">
      {{ isCk ? '目标端建表参数（ClickHouse）' : '目标端索引参数（Elasticsearch）' }}
    </el-divider>

    <el-form v-if="isCk && ck" label-position="top" class="sink-grid">
      <el-form-item label="表引擎">
        <el-select v-model="ck.engine" aria-label="表引擎">
          <el-option v-for="item in CK_ENGINES" :key="item" :value="item" :label="item" />
        </el-select>
        <div class="sink-tip">
          <template v-if="needsVersionColumn">同一排序键重复写入时，后台合并保留版本列最大的一条</template>
          <template v-else>{{ ck.engine }} 不去重：重复同步会留下多条同键数据</template>
        </div>
      </el-form-item>
      <el-form-item label="版本列">
        <el-select v-model="ck.versionColumn" aria-label="版本列" :disabled="!needsVersionColumn" filterable
          clearable placeholder="留空取 update_time">
          <el-option v-for="item in choices" :key="item.name" :value="item.name" :label="item.remark" />
        </el-select>
        <div class="sink-tip">
          <template v-if="needsVersionColumn">只能是整型或时间类型；{{ CK_DEFAULT_VERSION_COLUMN }} 是框架固定列</template>
          <template v-else>所选引擎不使用版本列</template>
        </div>
      </el-form-item>
      <el-form-item label="排序键">
        <el-select v-model="ck.orderByColumns" aria-label="排序键" multiple filterable
          placeholder="留空则取表格中勾选的去重列">
          <el-option v-for="item in choices" :key="item.name" :value="item.name" :label="item.remark" />
        </el-select>
        <div class="sink-tip">
          <template v-if="orderByHint"><span class="sink-warn">{{ orderByHint }}</span></template>
          <template v-else>当前取勾选的去重列：{{ dedup.join('、') || '（无）' }}；排序键变更不会重排已有数据，需换表名重建</template>
        </div>
      </el-form-item>
    </el-form>

    <el-form v-else-if="es" label-position="top" class="sink-grid">
      <el-form-item label="索引名">
        <el-input v-model="es.index" aria-label="索引名" :placeholder="autoIndex" />
        <div class="sink-tip">
          <template v-if="indexInvalid"><span class="sink-warn">索引名必须小写，不能含大写字母、空格与 * " &lt; &gt; | , / \ ?，且不以 - _ 开头</span></template>
          <template v-else>留空则按库表名自动生成：{{ autoIndex }}</template>
        </div>
      </el-form-item>
      <el-form-item label="主分片数">
        <el-input-number v-model="es.shards" :min="1" :controls="false" />
        <div class="sink-tip">索引建成后不可改，只能 reindex</div>
      </el-form-item>
      <el-form-item label="副本数">
        <el-input-number v-model="es.replicas" :min="0" :controls="false" />
        <div class="sink-tip">单节点集群用 0</div>
      </el-form-item>
      <el-form-item label="dynamic">
        <el-radio-group v-model="es.dynamic">
          <el-radio-button v-for="item in ES_DYNAMICS" :key="item" :value="item">{{ item }}</el-radio-button>
        </el-radio-group>
        <div class="sink-tip">
          <template v-if="es.dynamic === 'strict'">源表新增列时写入直接报错，mapping 不会无限膨胀</template>
          <template v-else-if="es.dynamic === 'false'">新列静默忽略、不索引也不报错</template>
          <template v-else>新列自动建字段，mapping 随源表增长</template>
        </div>
      </el-form-item>
      <el-form-item label="分区粒度">
        <el-select v-model="es.indexPartition" aria-label="分区粒度">
          <el-option v-for="item in ES_PARTITIONS" :key="item" :value="item" :label="partitionLabels[item]" />
        </el-select>
        <div class="sink-tip">改粒度后新文档落新索引，历史索引不会自动迁移</div>
      </el-form-item>
      <el-form-item label="水位列">
        <el-select v-model="es.timeField" aria-label="水位列" filterable clearable placeholder="留空取映射到 origin_update_time 的列">
          <el-option v-for="item in choices" :key="item.name" :value="item.name" :label="item.remark" />
        </el-select>
      </el-form-item>
      <el-form-item label="文档 _id 组成列">
        <el-select v-model="es.idColumns" aria-label="_id 组成列" multiple filterable placeholder="留空则取勾选的去重列">
          <el-option v-for="item in choices" :key="item.name" :value="item.name" :label="item.remark" />
        </el-select>
        <div class="sink-tip">同一 _id 覆盖写入；当前取{{ es.idColumns.length ? '' : '勾选的去重列' }}：{{ (es.idColumns.length ? es.idColumns : dedup).join('、') || '（无）' }}</div>
      </el-form-item>
      <el-form-item label="字段 mapping 覆盖" class="sink-span">
        <el-table :data="es.fieldOverrides" border size="small" class="sink-override">
          <el-table-column label="目标列" min-width="150"><template #default="{ row }">
            <el-select v-model="row.column" filterable placeholder="选择列">
              <el-option v-for="item in choices" :key="item.name" :value="item.name" :label="item.remark" />
            </el-select></template></el-table-column>
          <el-table-column label="mapping 类型" width="140"><template #default="{ row }">
            <el-select v-model="row.type"><el-option v-for="item in ES_FIELD_TYPES" :key="item" :value="item" :label="item" /></el-select>
          </template></el-table-column>
          <el-table-column label="keyword 子字段" width="120"><template #default="{ row }">
            <el-checkbox v-model="row.keyword" :disabled="row.type !== 'text'" />
          </template></el-table-column>
          <el-table-column label="日期格式" min-width="170"><template #default="{ row }">
            <el-input v-model="row.format" :disabled="row.type !== 'date'" placeholder="留空用默认 yyyy-MM-dd HH:mm:ss" />
          </template></el-table-column>
          <el-table-column label="操作" width="70"><template #default="{ $index }">
            <el-button link type="danger" @click="es.fieldOverrides.splice($index, 1)">删除</el-button>
          </template></el-table-column>
        </el-table>
        <div class="sink-row"><el-button link type="primary" @click="addOverride">增加覆盖项</el-button>
          <span class="sink-tip">只记录与自动映射不一致的列，留空列表即全部按默认映射建 field</span></div>
      </el-form-item>
    </el-form>

    <div class="sink-preview"><span>产物预览</span><pre>{{ preview }}</pre></div>
    <p v-if="tableExists" class="sink-warn">
      目标表已存在：新参数只会重新下发一份建表语句，不会改动已建好的表，需重建表（ES 为 reindex）后才生效
    </p>
  </section>
</template>

<style scoped>
.sink-panel { max-width: 900px; margin: 8px auto 0; }
.sink-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 22px; }
.sink-grid :deep(.el-select), .sink-grid :deep(.el-input) { width: 100%; }
.sink-span { grid-column: 1 / -1; }
.sink-tip { color: #64748b; font-size: 12px; line-height: 1.6; }
.sink-warn { color: #d97706; }
.sink-row { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.sink-override { width: 100%; }
.sink-preview { margin-top: 14px; padding: 10px 12px; border: 1px solid #e5eaf2; border-radius: 8px; background: #f8fafc; }
.sink-preview span { color: #64748b; font-size: 12px; }
.sink-preview pre { margin: 6px 0 0; font-size: 12px; line-height: 1.7; white-space: pre-wrap; color: #0f172a; }
@media (max-width: 760px) { .sink-grid { grid-template-columns: 1fr; } }
</style>
