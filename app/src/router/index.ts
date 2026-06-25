import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/overview' },
  { path: '/overview', component: () => import('../views/Overview/index.vue') },
  { path: '/canvas', component: () => import('../views/FlowCanvas/index.vue') },
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
