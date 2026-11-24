// 建源默认值（1123 A1 / A2）：各建源入口共用，口径保持一致。
// - 默认流程：已有网站下新建源，默认复制「本网站最常用的流程」（挂的源最多的那条）。
// - 业务目录：默认网站自己的业务目录（网站的 categoryId 就是业务目录，见 SiteEditorDialog）。
//   没有「源 → 所在业务目录」的反查接口（整树扫一遍要几十个请求），所以不按同站源的目录统计。
import type { Site, Source } from '@/api'
import { loadDirPath } from '@/api/sourceDirs'
import type { CategorySelection } from '@/views/FlowCanvas/source/CategoryTreePicker.vue'

/** 网站源里挂最常用流程的那个源（作模板源）；都没有流程时取第一个源；没有源返回 null */
export function mostUsedFlowSource(sources: readonly Source[]): Source | null {
  const counts = new Map<string, number>()
  for (const source of sources) {
    const flowId = source.flowId
    if (flowId && flowId !== '0') counts.set(flowId, (counts.get(flowId) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [flowId, count] of counts) {
    if (count > bestCount) { best = flowId; bestCount = count }
  }
  return (best ? sources.find(source => source.flowId === best) : undefined) ?? sources[0] ?? null
}

/** 网站的业务目录 → 目录选择框的值（补齐完整路径；拿不到路径时用叶子名） */
export async function siteBizDirSelection(site: Partial<Pick<Site, 'dirId' | 'category' | 'categoryPath'>> | null | undefined): Promise<CategorySelection | null> {
  const dirId = site?.dirId
  if (!dirId || dirId === '0') return null
  const leaf = (site.categoryPath || site.category || '').split('/').filter(Boolean).pop() ?? ''
  try {
    const path = await loadDirPath(dirId)
    return { dirId, category: path[path.length - 1] ?? leaf, categoryPath: `/${path.join('/')}` }
  } catch {
    return leaf ? { dirId, category: leaf, categoryPath: `/${leaf}` } : null
  }
}
