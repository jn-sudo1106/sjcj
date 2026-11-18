<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { runnerManagementApi as api, type CodeServerRelease, type CodeServerPackageInfo } from '@/api/runnerManagement'
import { formatRunnerDateTime } from '@/utils/format/runnerHeartbeat'
import RunnerManagementTab from './RunnerManagementTab.vue'

const route=useRoute(), router=useRouter()
const props=defineProps<{ codeServerOnly?: boolean }>()
const program=computed(() => props.codeServerOnly || route.query.program === 'code-server' ? 'code-server' : 'runner')
const canWrite=computed(() => useAuthStore().role === 'admin')
const rows=ref<CodeServerRelease[]>([]), keyword=ref(''), error=ref(''), busy=ref(false)
const visible=computed(() => rows.value.filter(row => `${row.version} ${row.digest} ${formatRunnerDateTime(row.publishedAt)}`.toLowerCase().includes(keyword.value.toLowerCase())))
const selected=ref<CodeServerRelease | null>(null), detailOpen=ref(false)
const packageOpen=ref(false), platform=ref(''), target=ref<CodeServerRelease | null>(null), updateOnly=ref(false)
const packageInfo=ref<CodeServerPackageInfo | null>(null), packageError=ref('')
const problem=(e:unknown) => e instanceof Error ? e.message : String(e)
async function load() {
  if(program.value!=='code-server') return
  busy.value=true;error.value='';packageError.value=''
  const [releases,info]=await Promise.allSettled([api.codeServerReleases(),api.codeServerPackageInfo()])
  if(releases.status==='fulfilled') rows.value=releases.value.items
  else error.value=problem(releases.reason)
  if(info.status==='fulfilled') packageInfo.value=info.value
  else {packageInfo.value=null;packageError.value=problem(info.reason)}
  busy.value=false
}
async function publish() {
  busy.value=true;error.value=''
  try {
    const result=await api.publishCodeServer()
    ElMessage.success(result.created ? '智能体新版本已发布' : '源码未变化，已复用现有版本')
    await load()
  }catch(e){error.value=problem(e)}finally{busy.value=false}
}
async function openPackage(row:CodeServerRelease | null) {
  target.value=row;updateOnly.value=!row;busy.value=true;error.value=''
  try {packageInfo.value=await api.codeServerPackageInfo();platform.value=packageInfo.value.platform;packageOpen.value=true}
  catch(e){error.value=problem(e)}finally{busy.value=false}
}
async function download() {
  busy.value=true;error.value=''
  try {
    const blob=updateOnly.value ? await api.downloadCodeServerMigrationPackage(platform.value.trim())
      : await api.downloadCodeServerPackage(platform.value.trim(),target.value!.digest)
    const url=URL.createObjectURL(blob)
    const link=document.createElement('a');link.href=url
    link.download=updateOnly.value ? '智能体启动器更新包-' + (packageInfo.value?.package?.version || 'latest') + '.zip' : `智能体服务包-${target.value!.version}-${target.value!.digest.slice(7,19)}.zip`
    link.click();setTimeout(() => URL.revokeObjectURL(url),1000);packageOpen.value=false
  }catch(e){error.value=problem(e)}finally{busy.value=false}
}
function switchProgram(value:string) { void router.replace({path:'/settings',query:{tab:'releases',program:value}}) }
watch(program,() => { keyword.value='';error.value='';detailOpen.value=false;packageOpen.value=false;void load() })
onMounted(() => {void load()})
</script>

<template>
  <section class="pv-page" data-testid="program-versions">
    <nav v-if="!codeServerOnly" class="pv-types" aria-label="程序类型"><button type="button" class="active" @click="switchProgram('runner')">Runner</button></nav>
    <RunnerManagementTab v-if="program==='runner'" section="releases" />
    <template v-else>
      <p class="pv-auto-update" role="note">首次安装接入后，服务程序和启动器自动跟随平台已发布版本更新；有任务时等待空闲，更新失败保留上一版本。更新包用于旧实例修复。</p>
      <div class="pv-current-package" data-testid="current-code-server-package"><div><strong>智能体当前下载包</strong><template v-if="packageInfo?.package"><code>{{ packageInfo.package.version }}</code><span>更新于 {{ formatRunnerDateTime(packageInfo.package.updatedAt) }}</span></template><span v-else>{{ busy ? '正在读取版本…' : packageError ? '下载包信息加载失败' : '下载包版本信息未提供' }}</span></div><el-button v-if="canWrite" type="primary" :disabled="busy || !!packageError" @click="openPackage(null)">下载启动器更新包</el-button></div>
      <p v-if="packageError" class="pv-error" role="alert">{{ packageError }}</p>
      <div class="pv-toolbar"><el-input v-model="keyword" clearable placeholder="服务版本号、摘要、发布时间" style="max-width:280px" /><el-button :loading="busy" @click="load">刷新</el-button><el-button v-if="canWrite" type="primary" :disabled="busy" data-testid="publish-code-server" @click="publish">发布智能体服务版本</el-button></div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <div class="pv-table"><el-table :data="visible" v-loading="busy" empty-text="暂无智能体版本">
        <el-table-column label="服务版本号" min-width="160"><template #default="{row}">{{ row.version }} <el-tag v-if="row.digest===rows[0]?.digest" size="small">最新服务版本</el-tag></template></el-table-column>
        <el-table-column label="服务发布时间" min-width="180"><template #default="{row}">{{ formatRunnerDateTime(row.publishedAt) }}</template></el-table-column>
        <el-table-column label="版本标识" min-width="180"><template #default="{row}"><span :title="row.digest">{{ row.digest.slice(7,19) }}</span></template></el-table-column>
        <el-table-column label="操作" width="180"><template #default="{row}"><el-button link @click="selected=row;detailOpen=true">详情</el-button><el-button v-if="canWrite" link type="primary" :disabled="busy" @click="openPackage(row)">下载服务包</el-button></template></el-table-column>
      </el-table></div>
    </template>
    <el-drawer v-model="detailOpen" title="智能体版本详情" size="min(540px,94vw)"><dl v-if="selected" class="pv-info"><dt>版本号</dt><dd>{{ selected.version }}</dd><dt>发布时间</dt><dd>{{ formatRunnerDateTime(selected.publishedAt) }}</dd><dt>版本摘要</dt><dd>{{ selected.digest }}</dd></dl></el-drawer>
    <el-dialog v-model="packageOpen" :title="updateOnly?'下载启动器更新包':'下载智能体服务包'" width="min(560px,94vw)" :close-on-click-modal="!busy"><p v-if="packageInfo?.package" data-testid="download-code-server-package-version">下载包版本 {{ packageInfo.package.version }} · {{ formatRunnerDateTime(packageInfo.package.updatedAt) }}</p><el-form label-position="top"><el-form-item label="管理服务地址"><el-input v-model="platform" /></el-form-item></el-form><p v-if="updateOnly">包含新登记码和上方填写的管理服务地址，启动时自动写入 config.json。已有工作空间、监听端口和实例身份会保留。关闭程序后覆盖解压，再启动一次。</p><p v-else>版本：{{ target?.version }}。服务包包含独立登记码，上方填写的管理服务地址会写入配置文件。</p><el-alert v-if="error" :title="error" type="error" :closable="false" /><template #footer><el-button :disabled="busy" @click="packageOpen=false">取消</el-button><el-button type="primary" :loading="busy" :disabled="!platform.trim()" @click="download">下载</el-button></template></el-dialog>
  </section>
</template>

<style scoped>
.pv-auto-update{margin:0;color:var(--el-text-color-secondary);font-size:12px;line-height:1.6}
.pv-current-package{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid var(--el-border-color-lighter);border-radius:6px}.pv-current-package>div{display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;min-width:0}.pv-current-package span{font-size:12px;color:var(--el-text-color-secondary)}.pv-current-package code{overflow-wrap:anywhere}.pv-error{margin:0;color:var(--el-color-danger);font-size:12px}.pv-page{display:flex;flex:1;min-height:0;flex-direction:column;gap:12px}.pv-types{display:flex;gap:6px}.pv-types button{padding:7px 18px;border:1px solid var(--el-border-color);border-radius:6px;background:var(--el-bg-color);color:var(--el-text-color-regular);cursor:pointer}.pv-types button.active{color:var(--el-color-primary);border-color:var(--el-color-primary);background:var(--el-color-primary-light-9)}.pv-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pv-table{flex:1;min-height:0;overflow:auto}.pv-info{display:grid;grid-template-columns:90px minmax(0,1fr);gap:14px;font-size:13px}.pv-info dd{margin:0;overflow-wrap:anywhere}
</style>
