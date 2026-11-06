<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { configApi, type Config } from '../../api'
import StatusTag from '@/components/StatusTag.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'

const list = ref<Config[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
const keyword = ref('')
const stateFilter = ref('all')
const drawer = reactive<{ visible: boolean; cfg: Config | null }>({ visible: false, cfg: null })

async function load() {
  loading.value = true
  try {
    const r = await configApi.configPaged({ keyword: keyword.value, state: stateFilter.value, page: page.value, size: size.value })
    list.value = r.list
    total.value = r.total
  } finally {
    loading.value = false
  }
}
function resetAndLoad() {
  page.value = 1
  load()
}
watch(stateFilter, resetAndLoad)
let kw: ReturnType<typeof setTimeout> | undefined
watch(keyword, () => {
  clearTimeout(kw)
  kw = setTimeout(resetAndLoad, 300)
})
function onSize() {
  page.value = 1
  load()
}
onMounted(load)

function openDetail(c: Config) {
  drawer.cfg = c
  drawer.visible = true
}
// 清缓存已下线：列表靠刷新重查，不再调 config/clear。
function onSend(c: Config) {
  return configApi.sendConfigTask(c.configId)
}
function onCopy(c: Config) {
  return configApi.copyAll(c.configId)
}
function onDelete(c: Config) {
  return configApi.deleteConfig(c.configId)
}
</script>

<template>
  <div class="rc-card ct-main">
    <div class="rc-toolbar wrap">
      <el-input v-model="keyword" :prefix-icon="Search" clearable placeholder="搜索配置 ID / 名称 / 主题" style="width: 240px" />
      <el-select v-model="stateFilter" style="width: 120px">
        <el-option label="全部状态" value="all" />
        <el-option label="启用" value="enabled" />
        <el-option label="停用" value="disabled" />
      </el-select>
      <span class="ct-spacer" />
      <span class="muted">共 {{ total }} 个配置</span>
    </div>

    <div v-loading="loading" class="rc-table-scroll ct-table">
      <table class="rc-data-table">
        <thead>
          <tr>
            <th style="width: 90px">配置 ID</th>
            <th>名称</th>
            <th style="width: 150px">主题(队列)</th>
            <th style="width: 110px">运行策略</th>
            <th style="width: 96px">绑定源·参数</th>
            <th style="width: 118px">类型</th>
            <th style="width: 70px">状态</th>
            <th style="width: 178px">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in list" :key="c.configId">
            <td>{{ c.configId }}</td>
            <td><button class="ct-name" type="button" @click="openDetail(c)">{{ c.name }}</button></td>
            <td>{{ c.topic || '—' }}</td>
            <td>{{ c.policy || '—' }}</td>
            <td>{{ c.sourceCount ?? 0 }} · {{ c.paramRefs?.length ?? 0 }}</td>
            <td>
              <!-- isDetail 现在表示"非列表类"（isMulti 0 或 2）；2 是「更新父表」，按原义标出来 -->
              <StatusTag v-if="c.multiMode === 2" text="更新父表" tone="run" :show-icon="false" />
              <StatusTag v-else-if="c.isDetail" text="详情类" tone="run" :show-icon="false" />
              <StatusTag v-if="c.isLogin" text="登陆类" tone="warn" :show-icon="false" class="ct-tag2" />
              <span v-if="!c.isDetail && !c.isLogin" class="muted">普通</span>
            </td>
            <td><StatusTag :text="c.enabled ? '启用' : '停用'" :tone="c.enabled ? 'ok' : 'muted'" :show-icon="false" /></td>
            <td>
              <el-button link type="primary" size="small" @click="openDetail(c)">详情</el-button>
              <ConfirmButton link type="primary" size="small" text="发配置" :title="`发配置：${c.name}`" :body="`将向「${c.name}」下发配置任务，是否继续？`" :action="() => onSend(c)" />
              <ConfirmButton link type="primary" size="small" text="复制" :title="`复制配置：${c.name}`" :body="`复制「${c.name}」？`" :action="() => onCopy(c)" />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!loading && !list.length" class="ct-empty muted">没有匹配的配置</div>
    </div>

    <div class="ct-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="size"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        size="small"
        @current-change="load"
        @size-change="onSize"
      />
    </div>

  <el-drawer v-model="drawer.visible" :with-header="false" size="440px" append-to-body>
    <div v-if="drawer.cfg" class="ct-d">
      <div class="ct-d-title">{{ drawer.cfg.name }}</div>
      <div class="ct-d-sub muted">配置 ID {{ drawer.cfg.configId }}</div>
      <dl class="rc-kv">
        <dt>主题(队列)</dt><dd>{{ drawer.cfg.topic || '—' }}</dd>
        <dt>运行策略</dt><dd>{{ drawer.cfg.policy || '—' }}</dd>
        <dt>绑定源数</dt><dd>{{ drawer.cfg.sourceCount ?? 0 }}</dd>
        <dt>责任人</dt><dd>{{ drawer.cfg.owner || '—' }}</dd>
        <dt>更新时间</dt><dd>{{ drawer.cfg.updatedAt || '—' }}</dd>
      </dl>
      <div class="ct-section">绑定参数</div>
      <div v-if="drawer.cfg.paramRefs?.length" class="ct-tags">
        <el-tag v-for="p in drawer.cfg.paramRefs" :key="p" size="small" effect="plain">{{ p }}</el-tag>
      </div>
      <div v-else class="muted">无绑定参数</div>
      <div class="ct-section">操作日志</div>
      <div class="rc-mini-card">配置发布 / 主题调整 / 策略变更等操作日志二期接入；演示环境占位。</div>
      <div class="ct-foot">
        <button class="rc-btn" type="button" @click="onSend(drawer.cfg)">发配置</button>
        <button class="rc-btn" type="button" @click="onCopy(drawer.cfg)">复制</button>
        <button class="rc-btn danger" type="button" @click="onDelete(drawer.cfg)">删除</button>
      </div>
    </div>
  </el-drawer>
  </div>
</template>

<style scoped>
.ct-main { display: flex; flex-direction: column; height: calc(100vh - 215px); min-height: 520px; }
.ct-spacer { flex: 1; }
.ct-table { flex: 1; }
.ct-name { padding: 0; border: 0; background: transparent; color: var(--rc-primary-ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.ct-name:hover { text-decoration: underline; }
.ct-tag2 { margin-left: 4px; }
.ct-empty { padding: 48px; text-align: center; }
.ct-pager { display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid var(--rc-border-soft); }
.ct-d { display: flex; flex-direction: column; gap: 4px; }
.ct-d-title { font-size: 15px; font-weight: 700; color: var(--rc-text); }
.ct-d-sub { font-size: 12px; margin-bottom: 8px; }
.ct-section { margin: 14px 0 8px; font-size: 13px; font-weight: 700; color: var(--rc-text); }
.ct-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.ct-foot { display: flex; gap: 8px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--rc-border-soft); }
</style>
