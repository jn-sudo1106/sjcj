-- 2026-11-13 ck_job_log.JOB_CONF 扩容为 LONGTEXT
--
-- 背景：运行详情要展示「本次检查的冻结配置」，执行器把 ck_source.CHECK_CONF 的完整副本
-- 写进 ck_job_log.JOB_CONF。AI 检查的 conf 里带生成脚本，通常 10KB 以上，而该列原本是
-- varchar(1000)、数据库 sql_mode 为空（非严格模式），写入时被静默截断成前 1000 字符，
-- 既丢了快照又留下半截 JSON（前端 parseRunConfig 只能判定为「没有快照」）。
--
-- 影响面：该列只用于展示/审计，Java 侧写入规则检查日志时仍会按自身逻辑控制在 999 字符内，
-- 不会因为扩容改变行为；Python 执行器写入完整 conf。
--
-- 回滚：把类型改回 varchar(1000) 前，必须先把超长值截断，否则非严格模式会静默丢数据：
--   UPDATE ck_job_log SET JOB_CONF = LEFT(JOB_CONF, 1000) WHERE CHAR_LENGTH(JOB_CONF) > 1000;
--   ALTER TABLE ck_job_log MODIFY COLUMN JOB_CONF VARCHAR(1000) NULL;

ALTER TABLE ck_job_log MODIFY COLUMN JOB_CONF LONGTEXT NULL;
