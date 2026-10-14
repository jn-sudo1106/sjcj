<script setup lang="ts">
// API 描述弹窗 —— 迁移旧 data-view `src/page/inst/modules/ApiDesc.vue`。
//
// 旧形态：`a-modal :width="1000"` + 三块「带复制按钮的 URL」+ 两张参数表 + 一张返回值表，
// 纯展示、无任何接口调用（`copyUrl` 走剪贴板）。
//
// 有意偏差（唯一的 1 处）：
//   旧模板把「[1] SQL取数据」和「发后续任务」两段**整段注释掉**了，只渲染「[2] ID取数」。
//   但 `showModal(url1, url2, url3)` 一直收三个 URL，调用方（MeasureData.handleShowApi）
//   也确实算了三个（ID取数 / nextStep2 / qs），即「算了但没显示」。这里按调用方的意图
//   把三段都渲染出来——数据本来就在手上，恢复的是被注释掉的壳，不是新增能力。
//   三段的顺序沿用旧注释里的编号：[1] SQL取数据 → [2] ID取数 → [3] 发后续任务。
//
// 复制走共享的 `copyToClipboard`（`@/utils/clipboard`）：部署站是 http 非安全上下文，
// `navigator.clipboard` 在线上压根不存在，那个 util 内部是「异步 API → execCommand 同步兜底 →
// 手动复制弹窗」三级降级。全仓规范：组件不得自己调 `navigator.clipboard`（`views/uiCopy.test.ts` 会扫）。
import { ref } from 'vue'
import { copyToClipboard } from '@/utils/clipboard'

defineOptions({ name: 'ApiDescDialog' })

const visible = ref(false)
const url1 = ref('')
const url2 = ref('')
const url3 = ref('')

function open(u1: string, u2: string, u3: string) {
  url1.value = u1
  url2.value = u2
  url3.value = u3
  visible.value = true
}

/** 旧 copyUrl：$copyText → 成功/失败各一条 message；现在交给 util 自己提示 */
function copyUrl(url: string, label: string) {
  void copyToClipboard(url, label)
}

/** [1] SQL取数据的请求参数（旧注释块内那张表） */
const SQL_PARAMS = [
  { name: 'type', type: '整型', required: '必填', limit: '-', desc: '实体类型ID，对应库中某数据表' },
  { name: 'sourceId', type: '长整型', required: '非', limit: '-', desc: '限制某源采集的数据,如全表数据，留空' },
  { name: 'page', type: '整型', required: '非', limit: '-', desc: '页码' },
  { name: 'sql', type: '字符串', required: '非', limit: '-', desc: "SQL条件，如 K1='abcd'" },
]

/** [2] ID取数的请求参数 */
const ID_PARAMS = [
  { name: 'size', type: '整型', required: '是', limit: '1-200', desc: '每次获取数量' },
  { name: 'startId', type: '长整型', required: '必填', limit: '最小为0', desc: '取数据的起始ID，如从头取，设成0' },
  { name: 'endId', type: '长整型', required: '非', limit: '-', desc: '限制取数据的最大ID，与startId配合用来取一段数据' },
]

/** 返回值说明 */
const RETURN_COLS = [
  { code: 'id', name: 'ID', type: '长整型', desc: '数据主键' },
  { code: 'state', name: '数据状态', type: '字符串', desc: 'D 表示软删除' },
  { code: 'lastId', name: '本次获取数据中最大ID', type: '长整型', desc: '获取下一批数据时，startId设为lastId+1' },
  { code: 'parentId', name: '上层数据ID', type: '长整型', desc: '详情表 与 列表表中关联字段' },
  { code: '[其它字段]', name: '其它字段', type: '-', desc: '参考数据表配置中相关字段详情' },
]

defineExpose({ open })
</script>

<template>
  <el-dialog
    v-model="visible"
    title="API描述"
    width="1000px"
    top="20px"
    destroy-on-close
    class-name="rc-dialog apid-dialog"
  >
    <!-- [1] SQL取数据 -->
    <div class="apid-row">
      <el-tag type="primary" effect="plain" size="small">[1] SQL取数据:</el-tag>
      <a class="apid-url" :href="url3" target="_blank" rel="noreferrer noopener nofollow">{{ url3 }}</a>
      <el-button link type="primary" @click="copyUrl(url3, 'SQL取数地址')">复制</el-button>
    </div>
    <div class="apid-label">请求URL:</div>
    <div class="apid-container">
      <table>
        <thead>
          <tr>
            <td style="width: 150px">参数</td>
            <td style="width: 100px">类型</td>
            <td style="width: 100px">必填</td>
            <td style="width: 100px">限制</td>
            <td>说明</td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in SQL_PARAMS" :key="row.name">
            <td>{{ row.name }}</td>
            <td>{{ row.type }}</td>
            <td>{{ row.required }}</td>
            <td>{{ row.limit }}</td>
            <td>{{ row.desc }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- [2] ID取数 -->
    <div class="apid-row">
      <el-tag type="primary" effect="plain" size="small">[2] ID取数:</el-tag>
      <a class="apid-url" :href="url1" target="_blank" rel="noreferrer noopener nofollow">{{ url1 }}</a>
      <el-button link type="primary" @click="copyUrl(url1, 'ID取数地址')">复制</el-button>
    </div>
    <div class="apid-label">请求URL:</div>
    <div class="apid-container">
      <table>
        <thead>
          <tr>
            <td style="width: 150px">参数</td>
            <td style="width: 100px">类型</td>
            <td style="width: 100px">必填</td>
            <td style="width: 100px">限制</td>
            <td>说明</td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ID_PARAMS" :key="row.name">
            <td>{{ row.name }}</td>
            <td>{{ row.type }}</td>
            <td>{{ row.required }}</td>
            <td>{{ row.limit }}</td>
            <td>{{ row.desc }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- [3] 发后续任务（旧模板中被注释掉的那段） -->
    <div class="apid-row">
      <el-tag type="primary" effect="plain" size="small">[3] 发后续任务:</el-tag>
      <a class="apid-url" :href="url2" target="_blank" rel="noreferrer noopener nofollow">{{ url2 }}</a>
      <el-button link type="primary" @click="copyUrl(url2, '发后续任务地址')">复制</el-button>
    </div>

    <!-- 返回值说明 -->
    <div class="apid-label">返回值说明:</div>
    <div class="apid-container">
      <table>
        <thead>
          <tr>
            <td style="width: 150px">编码</td>
            <td style="width: 150px">名称</td>
            <td style="width: 150px">类型</td>
            <td>说明</td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in RETURN_COLS" :key="row.code">
            <td>{{ row.code }}</td>
            <td>{{ row.name }}</td>
            <td>{{ row.type }}</td>
            <td>{{ row.desc }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </el-dialog>
</template>

<style scoped>
.apid-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.apid-url {
  flex: 1;
  min-width: 0;
  color: #01aaed;
  word-break: break-all;
}
.apid-label {
  margin-top: 8px;
  font-weight: 600;
}
.apid-container table {
  width: 100%;
  margin: 8px 0 16px;
  font-size: 12px;
  border: 1px solid #ebedf0;
  border-collapse: collapse;
  border-spacing: 0;
  empty-cells: show;
}
.apid-container thead {
  background: rgba(0, 0, 0, 0.02);
  font-size: 14px;
}
.apid-container tr td {
  padding: 5px;
  border: 1px solid #ebedf0;
}
</style>
