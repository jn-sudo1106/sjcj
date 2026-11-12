// cron 公共常量与工具 —— 旧 `src/utils/cron.js` 的 1:1 移植（CRON_PRESETS / describeCron / localCronCheck）。
//
// 这三样在旧项目里被三个地方共用（ScheduleConfig / CronEditModal / CategoryScheduleModal），
// 新项目按迁移约定自带一份（不引公共组件），放在本目录下。

/** 常用定时预设（文案 + 表达式），顺序与旧文件一致 */
export const CRON_PRESETS: { txt: string; cron: string }[] = [
  { txt: '每10秒钟', cron: '0/10 * * * * ?' },
  { txt: '每5分钟(@300秒)', cron: '@300' },
  { txt: '每30分钟', cron: '0 0/30 * * * ?' },
  { txt: '每1小时', cron: '0 0 0/1 * * ?' },
  { txt: '每2小时', cron: '0 0 0/2 * * ?' },
  { txt: '每天3点', cron: '0 0 3 * * ?' },
  { txt: '每天22点', cron: '0 0 22 * * ?' },
  { txt: '每月1日', cron: '0 0 0 1 * ?' },
  { txt: '每周一19点', cron: '0 0 19 ? * 1' },
]

/** 精确匹配的常见表达式 → 人话 */
const HUMAN_MAP: Record<string, string> = {
  '0/10 * * * * ?': '每10秒',
  '0 0/30 * * * ?': '每30分钟',
  '0 0 0/1 * * ?': '每小时整点',
  '0 0 0/2 * * ?': '每2小时',
  '0 0 3 * * ?': '每天3点',
  '0 0 22 * * ?': '每天22点',
  '0 0 0 1 * ?': '每月1日零点',
  '0 0 19 ? * 1': '每周一19点',
}

/**
 * cron → 运营能看懂的中文；识别不出来的返回空串（调用方自行决定要不要展示原文）。
 * 旧实现的三条判据原样保留：@秒数 → 精确映射表 → 每天N点 / 每n分钟两个模式。
 */
export function describeCron(cron: string | undefined | null): string {
  if (!cron) return ''
  const text = String(cron).trim()
  const secMatch = text.match(/^@(\d+)$/)
  if (secMatch) return `每 ${secMatch[1]} 秒`
  if (HUMAN_MAP[text]) return HUMAN_MAP[text]
  const parts = text.split(/\s+/)
  // 周段必须是 '?' 或 '*'，否则是「每周N」类表达式，不能概括成"每天/每n分钟"
  const dowFree = parts.length >= 6 && (parts[5] === '?' || parts[5] === '*')
  if (
    parts.length >= 6 &&
    parts[0] === '0' &&
    parts[1] === '0' &&
    /^\d{1,2}$/.test(parts[2] ?? '') &&
    parts[3] === '*' &&
    parts[4] === '*' &&
    dowFree
  ) {
    return `每天 ${Number(parts[2])} 点`
  }
  const minutePart = parts[1] ?? ''
  if (
    parts.length >= 6 &&
    parts[0] === '0' &&
    minutePart.indexOf('/') > 0 &&
    /^\d{1,2}$/.test(minutePart.split('/')[1] ?? '') &&
    parts[2] === '*' &&
    parts[3] === '*' &&
    parts[4] === '*' &&
    dowFree
  ) {
    return `每 ${Number(minutePart.split('/')[1])} 分钟`
  }
  return ''
}

/** cron 本地格式校验（不依赖后端）：合法返回 ''，非法返回给用户看的提示 */
export function localCronCheck(cron: string | undefined | null): string {
  const text = String(cron ?? '').trim()
  if (!text) return '请填写调度表达式'
  if (/^@\d+$/.test(text)) return ''
  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length === 6 || parts.length === 7) return ''
  return '表达式应为 6~7 段空格分隔的 spring cron（如 0 0/30 * * * ?），或 @秒数 格式'
}

/** @秒数 格式（可视化编辑器表达不了） */
export function isIntervalCron(cron: string | undefined | null): boolean {
  return /^@\d+$/.test(String(cron ?? '').trim())
}
