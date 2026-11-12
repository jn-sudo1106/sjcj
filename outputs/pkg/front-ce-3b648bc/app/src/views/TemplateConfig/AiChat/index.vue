<script setup lang="ts">
// AI 智能问数（Agent 交互对话工作台）
// 位于「问数配置」分组，支持 Text-to-SQL、多轮主动澄清与问答、思考链展示、KPI指标卡片、图表与明细切换
import { ref, computed, nextTick, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ChatDotRound,
  CopyDocument,
  Delete,
  Plus,
  Search,
  Select,
  TrendCharts,
} from '@element-plus/icons-vue'
import { listAiSessions, type AiSessionItem } from '@/api/aiChat'

// 会话
const sessions = ref<AiSessionItem[]>([])
const activeSessionId = ref<string>('s1')
const searchSessionKeyword = ref<string>('')

// 输入框与发送参数
const promptText = ref<string>('')
const enableReasoning = ref<boolean>(true)
const enableAutoChart = ref<boolean>(true)
const isSending = ref<boolean>(false)

// 交互澄清卡片状态
const clarifySelectedDim = ref<number>(1)
const clarifySelectedTime = ref<number>(2) // 1: 24h, 2: 7d, 3: 30d
const clarifyConfirmed = ref<boolean>(false)
const clarifyConfirming = ref<boolean>(false)

// 视图切换与思考链折叠
const activeDataView = ref<'chart' | 'table'>('chart')
const isThinkingExpanded = ref<boolean>(true)

const chatContainerRef = ref<HTMLElement | null>(null)

// 过滤后的会话分组
const todaySessions = computed(() =>
  sessions.value.filter(
    (s) =>
      s.group === 'today' &&
      (!searchSessionKeyword.value || s.title.includes(searchSessionKeyword.value))
  )
)

const weekSessions = computed(() =>
  sessions.value.filter(
    (s) =>
      s.group === 'week' &&
      (!searchSessionKeyword.value || s.title.includes(searchSessionKeyword.value))
  )
)

onMounted(async () => {
  sessions.value = await listAiSessions()
})

// 滚动到底部
function scrollToBottom() {
  nextTick(() => {
    if (chatContainerRef.value) {
      if (typeof chatContainerRef.value.scrollTo === 'function') {
        chatContainerRef.value.scrollTo({
          top: chatContainerRef.value.scrollHeight,
          behavior: 'smooth',
        })
      } else {
        chatContainerRef.value.scrollTop = chatContainerRef.value.scrollHeight
      }
    }
  })
}

// 选择澄清口径
function selectDimension(id: number) {
  if (clarifyConfirmed.value) return
  clarifySelectedDim.value = id
}

// 选择时间窗口
function selectTimeWindow(timeId: number) {
  if (clarifyConfirmed.value) return
  clarifySelectedTime.value = timeId
}

// 确认澄清
function handleConfirmClarify() {
  if (clarifyConfirming.value || clarifyConfirmed.value) return
  clarifyConfirming.value = true
  setTimeout(() => {
    clarifyConfirming.value = false
    clarifyConfirmed.value = true
    ElMessage.success('已采纳您选择的分析口径，数据下钻已完成！')
    scrollToBottom()
  }, 700)
}

// 复制 SQL
function handleCopySql(code: string) {
  navigator.clipboard.writeText(code)
  ElMessage.success('SQL 已成功复制到剪贴板')
}

// 快捷追问
function handleQuickPrompt(text: string) {
  promptText.value = text
  handleSend()
}

// 发送消息
function handleSend() {
  const content = promptText.value.trim()
  if (!content || isSending.value) return
  isSending.value = true
  promptText.value = ''
  scrollToBottom()

  setTimeout(() => {
    isSending.value = false
    ElMessage.success('智能体已响应您的指令，分析结果已刷新')
    scrollToBottom()
  }, 1000)
}

// 快捷键发送
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// 新建会话
function handleNewChat() {
  clarifyConfirmed.value = false
  clarifySelectedDim.value = 1
  clarifySelectedTime.value = 2
  ElMessage.info('已创建全新问数会话')
}
</script>

<template>
  <div class="rc-aichat-workbench">
    <!-- 1. 左侧会话历史侧栏 -->
    <aside class="rc-aichat-sidebar">
      <div class="rc-sidebar-header">
        <el-button type="primary" :icon="Plus" class="rc-newchat-btn" @click="handleNewChat">
          新建问数会话
        </el-button>
        <div class="rc-search-box">
          <el-input
            v-model="searchSessionKeyword"
            placeholder="搜索历史会话..."
            :prefix-icon="Search"
            size="small"
            clearable
          />
        </div>
      </div>

      <div class="rc-sidebar-sessions">
        <div v-if="todaySessions.length" class="rc-session-group">
          <div class="rc-session-group-title">今天</div>
          <div
            v-for="s in todaySessions"
            :key="s.id"
            class="rc-session-item"
            :class="{ active: activeSessionId === s.id }"
            @click="activeSessionId = s.id"
          >
            <el-icon class="rc-session-icon"><ChatDotRound /></el-icon>
            <span class="rc-session-title" :title="s.title">{{ s.title }}</span>
          </div>
        </div>

        <div v-if="weekSessions.length" class="rc-session-group">
          <div class="rc-session-group-title">近 7 天</div>
          <div
            v-for="s in weekSessions"
            :key="s.id"
            class="rc-session-item"
            :class="{ active: activeSessionId === s.id }"
            @click="activeSessionId = s.id"
          >
            <el-icon class="rc-session-icon"><ChatDotRound /></el-icon>
            <span class="rc-session-title" :title="s.title">{{ s.title }}</span>
          </div>
        </div>
      </div>

      <div class="rc-sidebar-footer">
        <span class="rc-history-count">已存 {{ sessions.length }} 个会话</span>
        <el-button link type="info" size="small" :icon="Delete">清空</el-button>
      </div>
    </aside>

    <!-- 2. 中间对话与分析工作台 -->
    <main class="rc-aichat-main">
      <!-- 顶部控制条 -->
      <header class="rc-aichat-topbar">
        <div class="rc-topbar-left">
          <span class="rc-aichat-brand">AI 智能问数</span>
          <el-tag size="small" type="primary" effect="plain" class="rc-badge-tag">Agent 工作台</el-tag>
        </div>
      </header>

      <!-- 消息交互流容器 -->
      <div ref="chatContainerRef" class="rc-chat-thread">
        <!-- 用户提问 1 -->
        <div class="rc-msg-row user">
          <div class="rc-msg-bubble user">
            <p>帮我排查一下最近的异常任务数据。</p>
            <div class="rc-msg-time">今天 15:35</div>
          </div>
          <div class="rc-avatar user">我</div>
        </div>

        <!-- 智能体交互卡片 1 -->
        <div class="rc-msg-row assistant">
          <div class="rc-avatar assistant">
            <el-icon><TrendCharts /></el-icon>
          </div>

          <div class="rc-msg-bubble assistant">
            <!-- 引导文字 -->
            <div class="rc-clarify-intro">
              <strong class="rc-highlight">👋 收到您的排查诉求：</strong>
              由于采集平台的「异常任务」涵盖不同故障阶段与业务口径，为了给您生成最准确的 SQL 与分析结论，<strong>请选择本次重点排查的维度与时间范围：</strong>
            </div>

            <!-- 过程中的多轮交互问答：口径澄清卡片 -->
            <div class="rc-interactive-card" :class="{ confirmed: clarifyConfirmed }">
              <div class="rc-card-header">
                <span class="rc-card-title">
                  <span class="rc-step-dot"></span>
                  请选择分析口径（点击卡片切换）：
                </span>
                <span class="rc-card-hint">智能体交互澄清 · 步骤 1/1</span>
              </div>

              <!-- 3 个维度的单选卡片 -->
              <div class="rc-dimension-grid">
                <div
                  class="rc-dim-card"
                  :class="{ selected: clarifySelectedDim === 1 }"
                  @click="selectDimension(1)"
                >
                  <div class="rc-dim-head">
                    <span class="rc-dim-name">🌐 抓取网络层异常</span>
                    <span class="rc-dim-badge">{{ clarifySelectedDim === 1 ? '●' : '○' }}</span>
                  </div>
                  <p class="rc-dim-desc">HTTP 403被封锁、504超时、SSL握手失败等网络拦截。</p>
                  <div class="rc-dim-meta">涉及表: ck_source_log</div>
                </div>

                <div
                  class="rc-dim-card"
                  :class="{ selected: clarifySelectedDim === 2 }"
                  @click="selectDimension(2)"
                >
                  <div class="rc-dim-head">
                    <span class="rc-dim-name">🧹 规则清洗异常</span>
                    <span class="rc-dim-badge">{{ clarifySelectedDim === 2 ? '●' : '○' }}</span>
                  </div>
                  <p class="rc-dim-desc">网页改版导致XPath失效、字段提取为空、正则校验未命中。</p>
                  <div class="rc-dim-meta">涉及表: ck_clean_error</div>
                </div>

                <div
                  class="rc-dim-card"
                  :class="{ selected: clarifySelectedDim === 3 }"
                  @click="selectDimension(3)"
                >
                  <div class="rc-dim-head">
                    <span class="rc-dim-name">⏱️ 调度队列积压</span>
                    <span class="rc-dim-badge">{{ clarifySelectedDim === 3 ? '●' : '○' }}</span>
                  </div>
                  <p class="rc-dim-desc">Runner执行器离线、任务排队超时被系统强制取消。</p>
                  <div class="rc-dim-meta">涉及表: sys_runner_task</div>
                </div>
              </div>

              <!-- 时间范围与操作栏 -->
              <div class="rc-card-footer">
                <div class="rc-time-group">
                  <span class="rc-sublabel">时间窗口:</span>
                  <div class="rc-time-chips">
                    <button
                      class="rc-time-btn"
                      :class="{ active: clarifySelectedTime === 1 }"
                      @click="selectTimeWindow(1)"
                    >
                      近 24 小时
                    </button>
                    <button
                      class="rc-time-btn"
                      :class="{ active: clarifySelectedTime === 2 }"
                      @click="selectTimeWindow(2)"
                    >
                      近 7 天
                    </button>
                    <button
                      class="rc-time-btn"
                      :class="{ active: clarifySelectedTime === 3 }"
                      @click="selectTimeWindow(3)"
                    >
                      近 30 天
                    </button>
                  </div>
                </div>

                <el-button
                  v-if="!clarifyConfirmed"
                  type="primary"
                  size="small"
                  :loading="clarifyConfirming"
                  @click="handleConfirmClarify"
                >
                  确认选择并开始分析 ➔
                </el-button>
                <el-tag v-else type="success" size="small" effect="light">
                  <el-icon><Select /></el-icon> 已采纳该口径
                </el-tag>
              </div>
            </div>

            <!-- 用户确认后的分析结果呈现区 -->
            <transition name="el-fade-in-linear">
              <div v-if="clarifyConfirmed" class="rc-confirmed-result">
                <!-- 思考过程面板 -->
                <div class="rc-thinking-box">
                  <div class="rc-thinking-header" @click="isThinkingExpanded = !isThinkingExpanded">
                    <div class="rc-thinking-title">
                      <span class="rc-live-dot green"></span>
                      <span>思考过程 · 已根据所选口径对齐并执行 SQL (耗时 1.1s)</span>
                    </div>
                    <span class="rc-toggle-arrow" :class="{ collapsed: !isThinkingExpanded }">▼</span>
                  </div>
                  <div v-if="isThinkingExpanded" class="rc-thinking-body">
                    <div>✓ 1. 采纳用户澄清口径：<strong>抓取网络层异常</strong>，聚合时段 = <code>NOW() - INTERVAL 7 DAY</code></div>
                    <div>✓ 2. 定位数据表：<code>ck_source_log</code> (记录失败原因)，关联 <code>sys_site</code> 提取站点名称</div>
                    <div>✓ 3. SQL 审查通过，执行耗时 82ms，扫描 32,450 行数据。</div>
                  </div>
                </div>

                <!-- 生成的 SQL 卡片 -->
                <div class="rc-sql-card">
                  <div class="rc-sql-head">
                    <div class="rc-sql-badge">
                      <span class="rc-sql-label">SQL QUERY</span>
                      <span class="rc-sql-meta">执行成功 · 扫描 32,450 行 · 耗时 82ms</span>
                    </div>
                    <el-button
                      link
                      type="primary"
                      size="small"
                      :icon="CopyDocument"
                      @click="handleCopySql(`SELECT s.site_name AS '网站名称', COUNT(l.log_id) AS '总任务数', SUM(CASE WHEN l.status = 1 THEN 1 ELSE 0 END) AS '成功数', ROUND(SUM(CASE WHEN l.status = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(l.log_id), 2) AS '采集成功率(%)' FROM ck_source_log l LEFT JOIN sys_site s ON l.site_id = s.site_id WHERE l.create_time >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY s.site_id, s.site_name ORDER BY '采集成功率(%)' ASC LIMIT 10;`)"
                    >
                      复制 SQL
                    </el-button>
                  </div>
                  <pre class="rc-sql-code">SELECT 
    s.site_name AS "网站名称",
    COUNT(l.log_id) AS "总采集任务数",
    SUM(CASE WHEN l.status = 1 THEN 1 ELSE 0 END) AS "成功数",
    ROUND(SUM(CASE WHEN l.status = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(l.log_id), 2) AS "采集成功率(%)"
FROM ck_source_log l
LEFT JOIN sys_site s ON l.site_id = s.site_id
WHERE l.create_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY s.site_id, s.site_name
ORDER BY "采集成功率(%)" ASC
LIMIT 10;</pre>
                </div>

                <!-- KPI 指标卡片 -->
                <div class="rc-kpi-grid">
                  <div class="rc-kpi-card">
                    <span class="rc-kpi-label">7天平均成功率</span>
                    <span class="rc-kpi-value green">97.45%</span>
                    <span class="rc-kpi-tip">↑ 较上周提升 +1.2%</span>
                  </div>
                  <div class="rc-kpi-card">
                    <span class="rc-kpi-label">总采集样本量</span>
                    <span class="rc-kpi-value">142,580 次</span>
                    <span class="rc-kpi-tip">覆盖全站 26 个源</span>
                  </div>
                  <div class="rc-kpi-card danger">
                    <span class="rc-kpi-label">网络异常最多网站</span>
                    <span class="rc-kpi-value red">行业资讯网</span>
                    <span class="rc-kpi-tip red">成功率仅 68.20% (失败 412 次)</span>
                  </div>
                </div>

                <!-- 图表/明细视图切换 -->
                <div class="rc-dataview-card">
                  <div class="rc-dataview-head">
                    <span class="rc-dataview-title">📊 网络层失败率最高 TOP 3 网站对比</span>
                    <el-radio-group v-model="activeDataView" size="small">
                      <el-radio-button value="chart">趋势图表</el-radio-button>
                      <el-radio-button value="table">明细数据表</el-radio-button>
                    </el-radio-group>
                  </div>

                  <!-- 进度柱状视图 -->
                  <div v-if="activeDataView === 'chart'" class="rc-chart-view">
                    <div class="rc-chart-item">
                      <div class="rc-bar-header">
                        <span class="rc-bar-title danger">1. 行业资讯网 (主要报错: HTTP 403 触发 IP 防火墙)</span>
                        <span class="rc-bar-val danger">68.20%</span>
                      </div>
                      <div class="rc-bar-track">
                        <div class="rc-bar-fill red" style="width: 68.2%"></div>
                      </div>
                    </div>
                    <div class="rc-chart-item">
                      <div class="rc-bar-header">
                        <span class="rc-bar-title warn">2. 地方科技信息通报 (主要报错: Read timed out 响应超时)</span>
                        <span class="rc-bar-val warn">81.50%</span>
                      </div>
                      <div class="rc-bar-track">
                        <div class="rc-bar-fill orange" style="width: 81.5%"></div>
                      </div>
                    </div>
                    <div class="rc-chart-item">
                      <div class="rc-bar-header">
                        <span class="rc-bar-title warn">3. 某商业招标采购网 (主要报错: Connection reset 连接重置)</span>
                        <span class="rc-bar-val warn">87.30%</span>
                      </div>
                      <div class="rc-bar-track">
                        <div class="rc-bar-fill orange" style="width: 87.3%"></div>
                      </div>
                    </div>
                  </div>

                  <!-- 表格视图 -->
                  <div v-else class="rc-table-view">
                    <table class="rc-preview-table">
                      <thead>
                        <tr>
                          <th>网站名称</th>
                          <th>总任务数</th>
                          <th>成功数</th>
                          <th>失败数</th>
                          <th>主要异常码</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>行业资讯网</td>
                          <td>1,296</td>
                          <td>884</td>
                          <td class="text-red">412</td>
                          <td class="text-warn">HTTP 403 Forbidden</td>
                        </tr>
                        <tr>
                          <td>地方科技信息通报</td>
                          <td>2,140</td>
                          <td>1,744</td>
                          <td class="text-red">396</td>
                          <td class="text-warn">SocketTimeoutException</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <!-- 专家诊断与建议 -->
                <div class="rc-insight-card">
                  <div class="rc-insight-title">💡 诊断与处置建议：</div>
                  <ul class="rc-insight-list">
                    <li>针对 <strong>行业资讯网</strong>：集中在每日上午 09:00~11:00 触发 403，建议启用动态隧道代理并设置随机延时（3~8秒）；</li>
                    <li>针对 <strong>地方科技信息通报</strong>：超时集中在详情页长文本抓取，建议将超时阈值从 15s 调宽至 30s。</li>
                  </ul>
                </div>

                <!-- 追问胶囊 -->
                <div class="rc-followup-chips">
                  <span class="rc-chips-label">智能追问:</span>
                  <el-button
                    size="small"
                    round
                    class="rc-chip-btn"
                    @click="handleQuickPrompt('帮我把上面失败率最高的前3个网站的数据导出为CSV表格')"
                  >
                    📥 导出 TOP 3 明细为 CSV
                  </el-button>
                  <el-button
                    size="small"
                    round
                    class="rc-chip-btn"
                    @click="handleQuickPrompt('给成功率低于85%的网站自动生成告警规则配置')"
                  >
                    ⚡ 针对异常源自动创建监控告警
                  </el-button>
                </div>
              </div>
            </transition>
          </div>
        </div>
      </div>

      <!-- 底部输入停靠区 -->
      <footer class="rc-aichat-footer">
        <div class="rc-input-box">
          <textarea
            v-model="promptText"
            rows="2"
            placeholder="向 AI 智能体提问，支持连续追问与交互澄清（按 Enter 发送，Shift+Enter 换行）..."
            class="rc-textarea"
            @keydown="handleKeyDown"
          ></textarea>

          <div class="rc-input-toolbar">
            <div class="rc-toolbar-left">
              <el-checkbox v-model="enableReasoning" label="深度思维(Reasoning)" size="small" />
              <el-checkbox v-model="enableAutoChart" label="自动生成图表" size="small" />
            </div>

            <el-button
              type="primary"
              size="small"
              :loading="isSending"
              class="rc-send-btn"
              @click="handleSend"
            >
              发送
            </el-button>
          </div>
        </div>
        <div class="rc-footer-caption">
          支持自然语言智能取数、图表生成、多轮口径交互澄清与业务诊断 · 基于 Agent SSE 流式接口驱动
        </div>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.rc-aichat-workbench {
  display: flex;
  height: calc(100vh - 54px);
  width: 100%;
  background: var(--rc-bg);
  overflow: hidden;
}

/* 左侧会话侧栏 */
.rc-aichat-sidebar {
  width: 250px;
  background: var(--rc-surface);
  border-right: 1px solid var(--rc-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.rc-sidebar-header {
  padding: 14px 12px 10px;
  border-bottom: 1px solid var(--rc-border-soft);
}

.rc-newchat-btn {
  width: 100%;
  margin-bottom: 10px;
}

.rc-sidebar-sessions {
  flex: 1;
  overflow-y: auto;
  padding: 8px 8px;
}

.rc-session-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--rc-muted);
  text-transform: uppercase;
  padding: 6px 8px;
}

.rc-session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--rc-radius-sm);
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 3px;
}

.rc-session-item:hover {
  background: var(--rc-primary-bg);
  color: var(--rc-primary);
}

.rc-session-item.active {
  background: var(--rc-primary-bg);
  color: var(--rc-primary);
  font-weight: 600;
  box-shadow: 0 0 0 1px var(--rc-primary);
}

.rc-session-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rc-sidebar-footer {
  padding: 10px 14px;
  border-top: 1px solid var(--rc-border-soft);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--rc-muted);
}

/* 右侧主工作区 */
.rc-aichat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--rc-canvas-bg);
}

/* 顶部控制栏 */
.rc-aichat-topbar {
  height: 48px;
  border-bottom: 1px solid var(--rc-border);
  background: var(--rc-glass);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
}

.rc-topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rc-aichat-brand {
  font-weight: 700;
  font-size: 15px;
  color: var(--rc-text);
}

/* 对话流 */
.rc-chat-thread {
  flex: 1;
  overflow-y: auto;
  padding: 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 960px;
  width: 100%;
  margin: 0 auto;
}

.rc-msg-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.rc-msg-row.user {
  justify-content: flex-end;
}

.rc-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.rc-avatar.user {
  background: var(--rc-text);
  color: #ffffff;
}

.rc-avatar.assistant {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  color: #ffffff;
}

.rc-msg-bubble {
  max-width: 820px;
  border-radius: var(--rc-radius);
}

.rc-msg-bubble.user {
  background: var(--rc-primary);
  color: #ffffff;
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.5;
  box-shadow: var(--rc-shadow-soft);
}

.rc-msg-time {
  font-size: 10px;
  opacity: 0.8;
  margin-top: 4px;
  text-align: right;
}

.rc-msg-bubble.assistant {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.rc-clarify-intro {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  padding: 12px 16px;
  border-radius: var(--rc-radius);
  font-size: 13px;
  line-height: 1.6;
  color: var(--rc-text);
}

.rc-highlight {
  color: var(--rc-primary);
}

/* 交互澄清卡片 */
.rc-interactive-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  padding: 16px;
  box-shadow: var(--rc-shadow-soft);
  transition: all 0.2s ease;
}

.rc-interactive-card.confirmed {
  opacity: 0.85;
}

.rc-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--rc-border-soft);
}

.rc-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--rc-text);
  display: flex;
  align-items: center;
  gap: 6px;
}

.rc-step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
}

.rc-card-hint {
  font-size: 11px;
  color: var(--rc-muted);
}

.rc-dimension-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.rc-dim-card {
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius-sm);
  padding: 12px;
  background: var(--rc-bg);
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.rc-dim-card:hover {
  border-color: var(--rc-primary);
}

.rc-dim-card.selected {
  border-color: var(--rc-primary);
  background: var(--rc-primary-bg);
}

.rc-dim-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.rc-dim-name {
  font-weight: 600;
  font-size: 12px;
  color: var(--rc-text);
}

.rc-dim-badge {
  color: var(--rc-primary);
  font-weight: bold;
}

.rc-dim-desc {
  font-size: 11px;
  color: var(--rc-muted);
  line-height: 1.4;
  margin: 8px 0;
}

.rc-dim-meta {
  font-family: monospace;
  font-size: 10px;
  color: var(--rc-primary);
}

.rc-card-footer {
  margin-top: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.rc-time-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rc-sublabel {
  font-size: 12px;
  color: var(--rc-muted);
}

.rc-time-chips {
  display: flex;
  gap: 4px;
}

.rc-time-btn {
  background: var(--rc-bg);
  border: 1px solid var(--rc-border);
  padding: 4px 10px;
  border-radius: var(--rc-radius-sm);
  font-size: 11px;
  color: var(--rc-text-2);
  cursor: pointer;
}

.rc-time-btn.active {
  background: var(--rc-primary);
  color: #ffffff;
  border-color: var(--rc-primary);
  font-weight: 600;
}

/* 确认后展示区域 */
.rc-confirmed-result {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 思考折叠面板 */
.rc-thinking-box {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  overflow: hidden;
}

.rc-thinking-header {
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--rc-text-2);
  cursor: pointer;
  background: var(--rc-bg);
}

.rc-thinking-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.rc-toggle-arrow {
  font-size: 10px;
  transition: transform 0.2s;
}

.rc-toggle-arrow.collapsed {
  transform: rotate(-90deg);
}

.rc-thinking-body {
  padding: 12px 14px;
  border-top: 1px solid var(--rc-border-soft);
  font-size: 12px;
  color: var(--rc-muted);
  line-height: 1.6;
}

/* SQL 卡片 */
.rc-sql-card {
  background: #0f172a;
  border-radius: var(--rc-radius);
  overflow: hidden;
  box-shadow: var(--rc-shadow-soft);
}

.rc-sql-head {
  padding: 8px 14px;
  background: #1e293b;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #334155;
}

.rc-sql-badge {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rc-sql-label {
  background: rgba(6, 182, 212, 0.15);
  color: #38bdf8;
  font-family: monospace;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(6, 182, 212, 0.3);
}

.rc-sql-meta {
  font-size: 11px;
  color: #94a3b8;
}

.rc-sql-code {
  margin: 0;
  padding: 12px 14px;
  font-family: monospace;
  font-size: 12px;
  color: #7dd3fc;
  overflow-x: auto;
  line-height: 1.5;
}

/* KPI 卡片 */
.rc-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.rc-kpi-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  padding: 12px;
  border-radius: var(--rc-radius);
  display: flex;
  flex-direction: column;
}

.rc-kpi-card.danger {
  border-color: #fecdd3;
  background: #fff1f2;
}

.rc-kpi-label {
  font-size: 11px;
  color: var(--rc-muted);
}

.rc-kpi-value {
  font-size: 20px;
  font-weight: 700;
  font-family: monospace;
  margin: 4px 0;
  color: var(--rc-text);
}

.rc-kpi-value.green {
  color: #16a34a;
}

.rc-kpi-value.red {
  color: #e11d48;
}

.rc-kpi-tip {
  font-size: 10px;
  color: var(--rc-muted);
}

.rc-kpi-tip.red {
  color: #e11d48;
}

/* 数据视图卡片 */
.rc-dataview-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  padding: 16px;
  border-radius: var(--rc-radius);
}

.rc-dataview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.rc-dataview-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--rc-text);
}

.rc-chart-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rc-bar-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}

.rc-bar-title.danger,
.rc-bar-val.danger {
  color: #e11d48;
  font-weight: 600;
}

.rc-bar-title.warn,
.rc-bar-val.warn {
  color: #d97706;
  font-weight: 600;
}

.rc-bar-track {
  width: 100%;
  height: 8px;
  background: var(--rc-bg);
  border-radius: 4px;
  overflow: hidden;
}

.rc-bar-fill {
  height: 100%;
  border-radius: 4px;
}

.rc-bar-fill.red {
  background: #f43f5e;
}

.rc-bar-fill.orange {
  background: #f59e0b;
}

.rc-preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.rc-preview-table th {
  background: var(--rc-bg);
  padding: 8px 10px;
  text-align: left;
  border-bottom: 1px solid var(--rc-border);
  color: var(--rc-muted);
}

.rc-preview-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--rc-border-soft);
  color: var(--rc-text);
  font-family: monospace;
}

.text-red {
  color: #e11d48;
  font-weight: 600;
}

.text-warn {
  color: #d97706;
}

/* 诊断建议 */
.rc-insight-card {
  background: var(--rc-surface);
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  padding: 14px 16px;
  font-size: 12px;
}

.rc-insight-title {
  font-weight: 600;
  color: var(--rc-text);
  margin-bottom: 6px;
}

.rc-insight-list {
  padding-left: 18px;
  color: var(--rc-text-2);
  line-height: 1.6;
}

/* 追问胶囊 */
.rc-followup-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.rc-chips-label {
  font-size: 11px;
  color: var(--rc-muted);
}

.rc-chip-btn {
  font-size: 11px;
}

/* 底部输入框 */
.rc-aichat-footer {
  border-top: 1px solid var(--rc-border);
  background: var(--rc-surface);
  padding: 14px 20px;
}

.rc-input-box {
  max-width: 960px;
  margin: 0 auto;
  border: 1px solid var(--rc-border);
  border-radius: var(--rc-radius);
  background: var(--rc-surface);
  padding: 10px 14px;
  box-shadow: var(--rc-shadow-soft);
  transition: border-color 0.2s;
}

.rc-input-box:focus-within {
  border-color: var(--rc-primary);
  box-shadow: 0 0 0 1px var(--rc-primary);
}

.rc-textarea {
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  font-family: var(--rc-font);
  font-size: 13px;
  color: var(--rc-text);
  background: transparent;
  line-height: 1.5;
}

.rc-input-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--rc-border-soft);
}

.rc-toolbar-left {
  display: flex;
  gap: 12px;
}

.rc-footer-caption {
  max-width: 960px;
  margin: 6px auto 0;
  text-align: center;
  font-size: 11px;
  color: var(--rc-faint);
}
</style>
