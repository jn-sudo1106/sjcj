<script setup lang="ts">
// 向量表数据浏览的单个查询窗口（旧 ai-chat-view src/demo/VectorDataShow.vue，1015 迁入问数配置组「基础配置」）。
// 口径照旧版：挂载即拉向量表下拉（config/all?name=）→ 选表 + 文本搜索 → 查询结果（data）整份 JSON 打进下方大文本框。
// 入参也照旧版原样发出（input/type/pageSize/pageNo，旧页面没有分页控件，pageNo/pageSize 恒为 1/20 随表单带着）。
//
// 与旧版的有意偏差（交付说明单列）：
// 1. 旧版结果框用可编辑的 a-textarea，但改动没有任何作用（内容只来自后端），这里置为只读，免得误清空查询结果。
// 2. 旧版请求失败不提示（裸 promise），这里与同域其余模块一致透出后端错误消息；查询失败保留上一次结果。
// 3. 旧版下拉的自定义 filterOption 读的是 Vue2 antd 的 componentOptions.children，EP 按 label 本地过滤，匹配行为一致。
// 4. 旧版残留的 handleTableConfigSearch 与同名自指的 vectorConfigList 方法在旧页面没有任何绑定，是死代码，不迁。
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { pocVectorConfigList, pocVectorDataQuery } from '@/api/templateConfig'
import type { VectorDataQuery, VectorTableOption } from '@/api/types/template'

defineOptions({ name: 'VectorDataPanel' })

const tableList = ref<VectorTableOption[]>([])
const queryParam = reactive<VectorDataQuery>({
  input: '',
  type: '',
  pageSize: 20,
  pageNo: 1,
})
const res = ref('')
const querying = ref(false)

// 旧 optionFilterProp=children 的展示文案：名称[备注]
function optionLabel(item: VectorTableOption) {
  return `${item.name}[${item.comment ?? ''}]`
}

async function queryTableList(name: string) {
  try {
    tableList.value = (await pocVectorConfigList(name)) ?? []
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
    tableList.value = []
  }
}

async function handleQuery() {
  if (querying.value) return
  querying.value = true
  try {
    const payload = await pocVectorDataQuery({ ...queryParam })
    res.value = payload === undefined ? '' : JSON.stringify(payload, null, 2)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载数据失败')
  } finally {
    querying.value = false
  }
}

onMounted(() => void queryTableList(''))
</script>

<template>
  <div class="vd-shell">
    <el-form :model="queryParam" size="small" label-width="0" @submit.prevent>
      <el-row :gutter="16">
        <el-col :span="8">
          <el-form-item>
            <el-select v-model="queryParam.type" filterable placeholder="请选择向量表" class="vd-table-select">
              <el-option v-for="item in tableList" :key="item.name" :value="item.name" :label="optionLabel(item)" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="4">
          <el-form-item>
            <el-button type="primary" :loading="querying" @click="handleQuery">查询</el-button>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="24">
          <el-form-item>
            <el-input v-model="queryParam.input" type="textarea" :rows="2" placeholder="文本搜索" class="vd-input-text" />
          </el-form-item>
        </el-col>
      </el-row>
    </el-form>

    <el-input v-model="res" type="textarea" readonly :autosize="{ minRows: 23, maxRows: 50 }" class="vd-result" />
  </div>
</template>

<style scoped>
.vd-shell {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.vd-table-select {
  width: 300px;
}
.vd-input-text {
  width: 100%;
}
.vd-result :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
</style>
