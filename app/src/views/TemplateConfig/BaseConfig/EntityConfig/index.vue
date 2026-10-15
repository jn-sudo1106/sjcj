<script setup lang="ts">
// 表字段管理（旧 ai-chat-view「基础配置 → 表字段管理」src/demo/EntityConfig.vue，1015 迁入问数配置组「基础配置」tab）。
// 页面形态与旧版一致：选表（远程搜索下拉，值为 entryTypeId）→ 回填表头 5 项 → 18 列行内编辑字段表 → 保存整表配置。
//
// 与旧版的有意偏差（交付说明单列）：
// 1. 旧版按 res.code===0 判成功、否则 ElMessage.error(res.message)；新 client.ts 对 code!==0 直接抛错并带出后端 msg，
//    所以这里成功即提示「保存成功」、失败统一走 catch 展示后端消息，展示口径不变。
// 2. 旧版保存直接把 useAlias 开关 / dataIndexFlag 回写成 0/1 覆盖在表单状态上（存完开关状态会跟着实体走），
//    这里只构造 payload 副本，页面状态保持 boolean —— 发给后端的字段与旧版完全一致。
// 3. 旧版请求失败不提示（裸 promise），这里与同域其余模块一致透出错误消息。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { pocEntityConfigSave, pocTableEntryList, pocTableFieldList } from '@/api/templateConfig'
import type { EntityConfigField, EntityConfigType, PocTableEntry } from '@/api/types/template'

defineOptions({ name: 'EntityConfigPage' })

const formRef = ref<FormInstance>()
// 旧口径：form.tableName 存的是选中表的 entryTypeId，不是表名
const form = reactive({
  tableName: '' as number | string,
  entityType: {
    aiComment: '',
    aiDesc: '',
    aiRule: '',
    aliasName: '',
    // 与旧版的有意偏差：旧版初始 useAlias 是 ''（开关默认关），迁移后按产品要求默认「是」
    useAlias: true,
  },
  entityItems: [] as EntityConfigField[],
})

const rules: FormRules = {
  tableName: [{ required: true, message: '请选择表', trigger: 'change' }],
  'entityType.aiComment': [{ required: true, message: '请输入表别名', trigger: 'blur' }],
  'entityType.aiDesc': [{ required: true, message: '请输入表描述', trigger: 'blur' }],
  'entityType.aiRule': [{ required: true, message: '请输入校验规则', trigger: 'blur' }],
  'entityType.aliasName': [{ required: true, message: '请输入生产表名称', trigger: 'blur' }],
  // 旧版对开关也挂了 required（恒通过），1:1 保留
  'entityType.useAlias': [{ required: true, message: '请输入生产表名称', trigger: 'change' }],
}

const tableList = ref<PocTableEntry[]>([])
const fieldLoading = ref(false)

async function queryTableList(name: string) {
  try {
    tableList.value = (await pocTableEntryList(name)) ?? []
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
    tableList.value = []
  }
}

// 旧 handleTableConfigSearch：空关键词不重查（保留当前列表）
function handleTableSearch(val: string) {
  if (!val) return
  void queryTableList(val)
}

async function queryTableDesc(tableId: number | string) {
  fieldLoading.value = true
  try {
    const data = await pocTableFieldList(tableId)
    form.entityItems = (data ?? []).map((item, index) => ({
      ...item,
      // key/no 与下面几个空串键是旧版行上的派生/残留键，保存时整行随 entityItems 发回后端（旧口径，不裁剪）
      key: item.itemId,
      no: index + 1,
      rule: '',
      aliasComment: '',
      indexType: '',
      businessType: '',
      businessFormat: '',
      dataIndexFlag: item.dataIndex === 1,
      vectorFlag: item.vector === 1,
    }))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
    form.entityItems = []
  } finally {
    fieldLoading.value = false
  }
}

// 旧 selectTableChange：按 entryTypeId 找回行，回填表头 5 项并拉字段
function selectTableChange(val: number | string) {
  if (!val) return
  const selected = tableList.value.find((item) => Number(item.entryTypeId) === Number(val))
  if (!selected) return
  form.entityType.aiComment = String(selected.aiComment ?? '')
  form.entityType.aiRule = String(selected.aiRule ?? '')
  form.entityType.aiDesc = String(selected.aiDesc ?? '')
  form.entityType.aliasName = String(selected.aliasName ?? '')
  // 旧版按 selectTable[0].useAlias === 1 落开关；这里只在字段缺失（null/undefined）时保持默认「是」，
  // 后端明确回 0/1 时照旧值回填
  form.entityType.useAlias = selected.useAlias == null ? true : Number(selected.useAlias) === 1
  void queryTableDesc(val)
}

// 旧 aiIndexTypeChange：切指标类型清空业务类型/格式，日期联动落 date/yyyyMMdd
function aiIndexTypeChange(row: EntityConfigField) {
  row.aiBusinessType = ''
  row.aiBusinessFormat = ''
  if (row.aiIndexType === 'date') {
    row.aiBusinessType = 'date'
    row.aiBusinessFormat = 'yyyyMMdd'
  }
}

// 旧 aiBusinessTypeChange：切业务类型清空格式，日期落 yyyyMMdd，数值型且指标列落 total
function aiBusinessTypeChange(row: EntityConfigField) {
  row.aiBusinessFormat = ''
  if (row.aiBusinessType === 'date') {
    row.aiBusinessFormat = 'yyyyMMdd'
  } else if (['int', 'float'].includes(String(row.aiBusinessType)) && row.aiIndexType === 'z') {
    row.aiBusinessFormat = 'total'
  }
}

const saving = ref(false)

async function save() {
  const valid = await formRef.value?.validate().catch(() => false)
  // EP 2.14.2 的 form.validate() 对空值可能放行（同域 ParamConfigEditDialog 已有先例），
  // 红字仍由 validate 给，拦不拦得住按旧必填项手工兜底
  const { aiComment, aiDesc, aiRule, aliasName } = form.entityType
  const filled = !!form.tableName && !!aiComment.trim() && !!aiDesc.trim() && !!aiRule.trim() && !!aliasName.trim()
  if (!valid || !filled) {
    ElMessage.error('请填写完整信息')
    return
  }
  const entityType: EntityConfigType = { ...form.entityType, entryTypeId: form.tableName }
  const list = tableList.value.filter((item) => Number(item.entryTypeId) === Number(form.tableName))
  if (list.length) entityType.tableName = list[0].tableName
  entityType.useAlias = form.entityType.useAlias ? 1 : 0
  const entityItems = form.entityItems.map((item) => ({
    ...item,
    dataIndex: item.dataIndexFlag ? 1 : 0,
    vector: item.vectorFlag ? 1 : 0,
  }))
  if (saving.value) return
  saving.value = true
  pocEntityConfigSave({ entityType, entityItems })
    .then(() => ElMessage.success('保存成功'))
    .catch((err: unknown) => ElMessage.error(err instanceof Error ? err.message : '保存失败'))
    .finally(() => {
      saving.value = false
    })
  // 旧版保存后立即重查表列表（不等保存响应），1:1 保留
  void queryTableList('')
}

onMounted(() => void queryTableList(''))
</script>

<template>
  <div class="ec-shell">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" size="small" @submit.prevent>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="选择表" prop="tableName">
            <el-select
              v-model="form.tableName"
              filterable
              remote
              :remote-method="handleTableSearch"
              placeholder="请选择表"
              class="ec-table-select"
              @change="selectTableChange"
            >
              <el-option
                v-for="item in tableList"
                :key="String(item.entryTypeId)"
                :value="item.entryTypeId as number"
                :label="item.tableName.replace('sense_data.', '') + '[' + (item.typeName ?? '') + ']'"
              />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row :gutter="16">
        <el-col :span="8">
          <el-form-item label="表别名" prop="entityType.aiComment">
            <el-input v-model.trim="form.entityType.aiComment" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="表描述" prop="entityType.aiDesc">
            <el-input v-model.trim="form.entityType.aiDesc" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="校验规则" prop="entityType.aiRule">
            <el-input v-model="form.entityType.aiRule" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="生产表名称" prop="entityType.aliasName">
            <el-input v-model.trim="form.entityType.aliasName" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="使用生产名称" prop="entityType.useAlias">
            <el-switch v-model="form.entityType.useAlias" />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <el-table
      v-loading="fieldLoading"
      :data="form.entityItems"
      border
      size="small"
      :row-key="(row: EntityConfigField) => String(row.key ?? row.itemId ?? '')"
    >
      <el-table-column prop="no" label="编号" width="80" align="center" fixed="left" />
      <el-table-column prop="itemCode" label="字段英文名" width="120" align="center" fixed="left" />
      <el-table-column label="生产字段" width="120" align="center" fixed="left">
        <template #default="{ row }"><el-input v-model="row.aliasName" /></template>
      </el-table-column>
      <el-table-column prop="dataType" label="数据类型" width="100" align="center" />
      <el-table-column label="字段中文名" width="200" align="center">
        <template #default="{ row }"><el-input v-model="row.itemName" /></template>
      </el-table-column>
      <el-table-column label="字段描述" width="200" align="center">
        <template #default="{ row }"><el-input v-model="row.aiComment" /></template>
      </el-table-column>
      <el-table-column label="数据索引" width="80" align="center">
        <template #default="{ row }"><el-checkbox v-model="row.dataIndexFlag" /></template>
      </el-table-column>
      <el-table-column label="抽取规则类型" width="130" align="center">
        <template #default="{ row }">
          <el-select v-model="row.chooseType" clearable class="ec-cell-select">
            <el-option :value="1" label="实体识别" />
            <el-option :value="2" label="正则" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="规则内容" width="130" align="center">
        <template #default="{ row }"><el-input v-model.trim="row.chooseRule" /></template>
      </el-table-column>
      <el-table-column label="映射类型" width="130" align="center">
        <template #default="{ row }">
          <el-select v-model="row.mappingType" clearable class="ec-cell-select">
            <el-option :value="1" label="编号" />
            <el-option :value="2" label="别名" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="映射字段" width="130" align="center">
        <template #default="{ row }"><el-input v-model.trim="row.mappingColumn" /></template>
      </el-table-column>
      <el-table-column label="指标类型" width="130" align="center">
        <template #default="{ row }">
          <el-select v-model="row.aiIndexType" class="ec-cell-select" @change="aiIndexTypeChange(row)">
            <el-option value="w" label="维度" />
            <el-option value="z" label="指标" />
            <el-option value="date" label="日期" />
            <el-option value="other" label="其他" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="业务类型" width="130" align="center">
        <template #default="{ row }">
          <el-select
            v-model="row.aiBusinessType"
            class="ec-cell-select"
            :disabled="row.aiIndexType === 'date'"
            @change="aiBusinessTypeChange(row)"
          >
            <el-option value="int" label="整数" />
            <el-option value="float" label="浮点数" />
            <el-option value="date" label="日期" />
            <el-option value="text" label="文本" />
            <el-option value="url" label="URL" />
            <el-option value="geo" label="地理位置" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="业务类型格式" width="200" align="center">
        <template #default="{ row }">
          <el-select
            v-if="['int', 'float'].includes(String(row.aiBusinessType)) && row.aiIndexType === 'z'"
            v-model="row.aiBusinessFormat"
            class="ec-cell-select-wide"
          >
            <el-option value="total" label="时点" />
            <el-option value="increment" label="流量" />
          </el-select>
          <el-select v-else-if="row.aiBusinessType === 'date'" v-model="row.aiBusinessFormat" class="ec-cell-select-wide">
            <el-option value="yyyyMMdd" label="yyyyMMdd" />
            <el-option value="yyyy-MM-dd" label="yyyy-MM-dd" />
          </el-select>
          <el-input v-else v-model="row.aiBusinessFormat" />
        </template>
      </el-table-column>
      <el-table-column label="校验规则" width="300" align="center">
        <template #default="{ row }"><el-input v-model="row.aiRule" /></template>
      </el-table-column>
      <el-table-column label="排序" width="100" align="center">
        <template #default="{ row }"><el-input-number v-model="row.aiSeq" :controls="false" class="ec-seq" /></template>
      </el-table-column>
      <el-table-column label="下钻sql配置" width="220" align="center">
        <template #default="{ row }"><el-input v-model.trim="row.subSql" type="textarea" /></template>
      </el-table-column>
      <el-table-column label="是否训练" width="80" align="center">
        <template #default="{ row }">
          <el-select v-model="row.trainingData" class="ec-cell-narrow">
            <el-option value="1" label="是" />
            <el-option value="0" label="否" />
          </el-select>
        </template>
      </el-table-column>
    </el-table>

    <div class="ec-save-bar">
      <el-button type="primary" :loading="saving" @click="save">保存配置</el-button>
    </div>
  </div>
</template>

<style scoped>
.ec-shell {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #fff;
  border: 1px solid var(--rc-border, #e2e8f0);
  border-radius: var(--rc-radius, 8px);
}
.ec-table-select {
  width: 320px;
}
.ec-cell-select {
  width: 100px;
}
.ec-cell-select-wide {
  width: 160px;
}
.ec-cell-narrow {
  width: 60px;
}
.ec-seq {
  width: 60px;
}
.ec-save-bar {
  display: flex;
  justify-content: center;
  padding: 4px 0 2px;
}
</style>
