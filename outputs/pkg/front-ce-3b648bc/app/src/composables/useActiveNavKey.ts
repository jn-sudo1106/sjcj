import { computed } from 'vue'
import { useRoute } from 'vue-router'

/** 侧栏 / 模块标题共用的导航高亮键：canvas → collect，其余取路由第一段 */
export function useActiveNavKey() {
  const route = useRoute()
  return computed(() => {
    const seg = route.path.split('/')[1] || 'overview'
    if (seg === 'canvas') return 'collect'
    return seg
  })
}
