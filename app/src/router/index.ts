import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/overview' },
  { path: '/overview', component: () => import('../views/Overview/index.vue') },
  {
    path: '/canvas',
    component: () => import('../views/FlowCanvas/index.vue'),
    // 0707 优化·Phase4：siteId 是网站统一流程模板的合法入口（画布切换器/卡片主体/页签均可达），与 sourceId 并列放行
    beforeEnter: (to) => (to.query.sourceId || to.query.siteId || to.query.mode === 'new' ? true : '/collect'),
  },
  { path: '/collect', component: () => import('../views/CollectAssets/index.vue') },
  { path: '/rules', component: () => import('../views/RuleAssets/index.vue') },
  { path: '/metrics', component: () => import('../views/MetricCenter/index.vue') },
  { path: '/data', component: () => import('../views/DataView/index.vue') },
  { path: '/runs', component: () => import('../views/RunRecords/index.vue') },
  { path: '/tools', component: () => import('../views/Monitor/index.vue') },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
