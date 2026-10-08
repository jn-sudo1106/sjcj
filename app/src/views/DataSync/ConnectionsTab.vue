<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { syncApi, type SyncClient, type SyncCustomer, type SyncDatabase } from '@/api/dataSync'

const auth = useAuthStore()
const admin = computed(() => auth.info?.name === 'admin')
const customers = ref<SyncCustomer[]>([])
const clients = ref<SyncClient[]>([])
const databases = ref<SyncDatabase[]>([])
const active = ref<'clients' | 'databases'>('clients')
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(10)
const loading = ref(false)
const loadError = ref('')
const filter = reactive({ customerId: admin.value ? '' : String(auth.info?.id ?? '') })

async function load() {
  loading.value = true
  try {
    const params = { customerId: filter.customerId, pageNo: pageNo.value, pageSize: pageSize.value }
    if (active.value === 'clients') {
      const res = await syncApi.clients(params); clients.value = res.list ?? []; total.value = res.total ?? 0
    } else {
      const res = await syncApi.databases(params); databases.value = res.list ?? []; total.value = res.total ?? 0
    }
    loadError.value = ''
  } catch (error) { loadError.value = String(error); clients.value = []; databases.value = []; total.value = 0; ElMessage.error(loadError.value) }
  finally { loading.value = false }
}
watch(() => filter.customerId, () => { pageNo.value = 1; void load() })
watch(active, () => { pageNo.value = 1; void load() })
onMounted(async () => {
  if (admin.value) {
    try { customers.value = await syncApi.customers() ?? [] }
    catch (error) { ElMessage.error(String(error)) }
  }
  await load()
})

async function changeSwitch(row: SyncClient, column: 'timingSync' | 'fileSync' | 'realtimeSync', enabled: boolean) {
  try { await syncApi.setClientSwitch(row.id, column, enabled); row[column] = enabled ? 'on' : 'off'; ElMessage.success('已更新') }
  catch (error) { ElMessage.error(String(error)); await load() }
}
function databaseType(value: number) { return ({ 1: 'MySQL', 2: 'PostgreSQL', 3: 'Oracle' } as Record<number, string>)[value] ?? String(value) }
</script>

<template>
  <div class="sync-panel">
    <el-alert v-if="loadError" :title="loadError" type="error" show-icon class="sync-alert" />
    <div class="sync-filter"><el-select v-if="admin" v-model="filter.customerId" clearable placeholder="全部客户" style="width:180px"><el-option v-for="item in customers" :key="item.id" :value="String(item.id)" :label="item.customerName" /></el-select><el-button @click="load">刷新</el-button></div>
    <el-tabs v-model="active"><el-tab-pane label="客户端配置" name="clients" /><el-tab-pane label="数据源配置" name="databases" /></el-tabs>
    <el-table v-if="active === 'clients'" v-loading="loading" :data="clients" border>
      <el-table-column prop="id" label="ID" width="80" /><el-table-column prop="customerId" label="客户 ID" width="90" />
      <el-table-column prop="clientName" label="应用名称" min-width="160" />
      <el-table-column v-for="item in [{ key: 'timingSync', label: '定时同步' }, { key: 'fileSync', label: '文件同步' }, { key: 'realtimeSync', label: '实时同步' }] as const" :key="item.key" :label="item.label" width="115">
        <template #default="{ row }"><el-switch :model-value="row[item.key] === 'on'" @change="(val: boolean) => changeSwitch(row, item.key, val)" /><span class="sync-state">{{ row[item.key] === 'on' ? '开启' : '关闭' }}</span></template>
      </el-table-column>
      <el-table-column prop="topics" label="消息主题" min-width="160" show-overflow-tooltip /><el-table-column prop="extendConfig" label="扩展参数" min-width="180" show-overflow-tooltip />
      <el-table-column prop="updateTime" label="更新时间" width="170" />
    </el-table>
    <el-table v-else v-loading="loading" :data="databases" border>
      <el-table-column prop="id" label="ID" width="80" /><el-table-column prop="name" label="名称" min-width="150" /><el-table-column prop="sourceCode" label="数据源名称" min-width="180" />
      <el-table-column prop="dbSchema" label="Schema" min-width="150" /><el-table-column label="数据库类型" width="120"><template #default="{ row }">{{ databaseType(row.databaseType) }}</template></el-table-column>
      <el-table-column label="类型" width="90"><template #default="{ row }">{{ Number(row.type) === 0 ? '数据库' : '文件库' }}</template></el-table-column>
      <el-table-column prop="updateTime" label="更新时间" width="170" />
    </el-table>
    <el-pagination v-model:current-page="pageNo" v-model:page-size="pageSize" class="sync-pagination" :total="total" :page-sizes="[10, 20, 50, 100]" layout="total, sizes, prev, pager, next" @change="load" />
  </div>
</template>

<style scoped>
.sync-filter { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }.sync-alert { margin-bottom: 12px; }.sync-state { margin-left: 6px; color: #64748b; font-size: 12px; }.sync-pagination { justify-content: flex-end; margin-top: 14px; }
</style>
