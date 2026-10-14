<script setup lang="ts">
// 「更多源...」选择弹窗 —— 迁移旧 data-view `src/page/base/detail/SourceListShow.vue`
// （它内嵌的是 `config/list/SourceList2.vue`，即源列表页的精简版）。
//
// 旧链路：`DSourceSelect.showMore()` → `SourceListShow.showModal()`（`a-modal` 宽 `clientWidth-100`，
// 内嵌 SourceList2 整页）→ 点确定读 `$refs.sourceList.selectedRows` → `$emit('selected', rows)`
// → 调用方 `handleSelected(rows)` 把选中的源灌回下拉的候选列表并选中第一个。
//
// **这是一处有意的替代实现**（不涉及接口口径的变化，只换了壳）：
//   `SourceList2` 是「源列表」整页的精简版（自带搜索栏 + 操作条 + 一堆弹层），旧平台把它整个塞进
//   `a-modal` 里当选择器用。新平台的源列表已经是独立页面（属于其它模块，本页不引用），
//   把整页搬进来既不合适也没必要。这里按**同样的用途**重做一个自包含的选择器：
//   源ID / 名称 / 状态 三个筛选 + 分页表格 + 多选 → 确定。
//   调用方拿到的 `rows` 结构与旧版一致（`Source[]`，取 `sourceId`），所以接线口不变。
//
// 筛选与列取自旧 SourceList2 的最常用字段（源ID / 名称 / URL / 配置ID / 主表 / 责任人 / 状态 / 更新时间）。
// 接口：`sourceApi.sourcePaged`（旧 `sourcePaged`）。
import { reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { sourceApi, type Source } from '@/api'

defineOptions({ name: 'MoreSourcesDialog' })

const emit = defineEmits<{ (e: 'selected', rows: Source[]): void }>()

const visible = ref(false)
const loading = ref(false)
const rows = ref<Source[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(20)
const form = reactive({ sourceId: '', name: '', state: '' })
const filters = reactive({ sourceId: '', name: '', state: '' })
const selected = ref<Source[]>([])

async function load() {
  loading.value = true
  try {
    const res = await sourceApi.sourcePaged({
      page: page.value,
      size: size.value,
      sourceId: filters.sourceId || undefined,
      name: filters.name || undefined,
      state: filters.state || undefined,
    })
    rows.value = res.list ?? []
    total.value = Number(res.total ?? 0)
  } catch (err) {
    ElMessage.error(`加载源列表失败: ${err instanceof Error ? err.message : String(err)}`)
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function open() {
  form.sourceId = ''
  form.name = ''
  form.state = ''
  filters.sourceId = ''
  filters.name = ''
  filters.state = ''
  page.value = 1
  selected.value = []
  visible.value = true
  void load()
}

function runQuery() {
  filters.sourceId = form.sourceId.trim()
  filters.name = form.name.trim()
  filters.state = form.state
  page.value = 1
  void load()
}

function onSubmit() {
  if (!selected.value.length) {
    ElMessage.warning('请选择一条源')
    return
  }
  emit('selected', [...selected.value])
  visible.value = false
}

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="源列表选择"
    width="90%"
    append-to-body
    destroy-on-close
    class-name="msd-dialog"
  >
    <el-form :inline="true" class="msd-filters">
      <el-form-item label="源ID">
        <el-input v-model="form.sourceId" clearable style="width: 140px" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="名称">
        <el-input v-model="form.name" clearable style="width: 180px" @keyup.enter="runQuery" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="form.state" clearable placeholder="请选择" style="width: 120px">
          <el-option label="全部" value="" />
          <el-option label="完成-C" value="C" />
          <el-option label="出错-E" value="E" />
          <el-option label="处理中-L" value="L" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :icon="Search" @click="runQuery">查询</el-button>
      </el-form-item>
    </el-form>

    <el-table
      v-loading="loading"
      :data="rows"
      border
      size="small"
      max-height="420"
      row-key="sourceId"
      @selection-change="(val: Source[]) => (selected = val)"
    >
      <el-table-column type="selection" width="42" />
      <el-table-column prop="sourceId" label="源ID" width="110" />
      <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
      <el-table-column prop="url" label="URL" min-width="220" show-overflow-tooltip />
      <el-table-column prop="configId" label="配置ID" width="90" />
      <el-table-column prop="mainTable" label="主表" width="110" />
      <el-table-column prop="owner" label="责任人" width="90" />
      <el-table-column prop="state" label="状态" width="80" />
      <el-table-column prop="updatedAt" label="更新时间" width="150" />
    </el-table>

    <div class="msd-pager">
      <el-pagination
        :current-page="page"
        :page-size="size"
        :total="total"
        :page-sizes="[20, 40, 100, 200]"
        layout="total, sizes, prev, pager, next, jumper"
        background
        small
        @current-change="(p: number) => { page = p; void load() }"
        @size-change="(s: number) => { size = s; page = 1; void load() }"
      />
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="onSubmit">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.msd-filters {
  margin-bottom: 0;
}
.msd-filters :deep(.el-form-item) {
  margin-bottom: 8px;
}
.msd-pager {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>
