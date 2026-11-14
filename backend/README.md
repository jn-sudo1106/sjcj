# 本地 Runner 服务

在 `E:\ce` 目录执行以下命令。需要 Python 3.11+、Git，以及 `cryptography`、`pymysql`。前端开发服务将 `/api/runner-management` 代理到本地 8092 端口。

```powershell
python -m pip install cryptography pymysql
$env:RUNNER_DEV_MODE='1'
python -m backend.runner_management.server
```

`RUNNER_DEV_MODE` 只用于本机联调。共享环境应设置 `RUNNER_AUTH_URL`（旧平台用户信息接口）或 `RUNNER_ADMIN_TOKEN`，并通过 HTTPS 反向代理公开服务。服务默认监听 `127.0.0.1:8092`；远程机器上的 Runner 必须使用可达的服务地址。签名私钥、令牌和本地 Git 仓库存放在被 Git 忽略的 `backend/.runtime/`，部署时需持久化和备份此目录。不能把私钥复制到 Runner 机器。

`RUNNER_AUTH_URL` 必须填写真实的 JSON 身份接口，例如 `http://118.25.96.217:9999/api/user-info.htm`；不可漏掉 `/api`，否则可能取得 HTML 页面。认证服务连接或响应格式异常返回 502；只有确认会话无效才返回 401，避免误清除用户登录状态。

186 同机部署使用 `RUNNER_AUTH_URL=http://127.0.0.1:9100/api/user-info.htm`；217 管理服务使用其同环境业务后端的 `/api/user-info.htm`，不要使用 `/api/v1/user/info` 或连接到 186。Nginx 只转发原始 `Cookie` / `Access-Token`，并清空 `X-Runner-Gateway`；该头不再授予登录身份或管理员权限。业务账号身份保留原始用户 ID，写操作仍要求 `roles` 数组包含 `admin`。`RUNNER_ADMIN_TOKEN` 仅用于受控运维调用，不得注入每个浏览器请求。部署验收须包含匿名 401、普通用户写操作 403、管理员操作成功，以及不同账号的批次隔离。

批量监控另需配置同环境的 `RUNNER_NODE_TYPE_BACKEND`：186 同机为 `http://127.0.0.1:9100`，217 按其实际业务后端设置（如 `http://118.25.96.217:9999`）。该配置不含 `/api` 后缀，必须与认证接口属于同一环境；否则即使登录验证通过，预检仍会报“尚未配置现有业务后台地址”。部署 nginx 时还应确认服务器级 `root` 与前端目录一致，避免精确匹配的 `/index.html` 继承默认欢迎页目录。

AI 监控脚本的业务库由 `RUNNER_MONITOR_RUNNER_CONFIG` 指向的私有 JSON 配置提供，连接字段为 `db.host/port/user/password/database`，脚本环境使用 `DQ_DB_*`（可通过配置的 `env` 覆盖）。执行器同时派生一致的 `DB_*` 别名，兼容已生成的脚本。186 当前业务库端口为 9907，这个端口没有写死在代码中；部署 217 必须配置其自己的业务库，不复制 186 的数据库配置或凭据。此处与下面 Runner 管理数据的 `RUNNER_DB_*` 是两套配置。

监控发布须同时检查前端、Python Runner 和 Java 业务后端。保存链路另有一个 Java 侧补丁 `java_patches/source_check_revision_cas.patch`（2026-11-13）：`/api/v1/source/check/update` 按主键单行更新，带 `ver` 时做乐观锁（不一致拒绝并提示「已被其他修改更新」），回执返回最新 `ver`。缺这个补丁时接口仍按行更新，但不会拦并发覆盖；前端会把记录上的 `ver` 一并提交，后端未实现时该字段被忽略，不报错。同一天还补了 `java_patches/ai_monitor_empty_schedule_update.patch`：`CkSourceService.calcNextDate` 对空 cron 直接返回 10 年后的时间，否则「仅手动」的 AI 检查在监控中心保存时会因 `Cron expression must consist of 6 fields (found 0 in "")` 报 500。两个补丁都已在 186 上编译部署（`/tmp/build_c13.sh` + `/tmp/deploy_c13.sh` 流程，jar 备份 `bee-config.jar.bak-c13-*`）。

2026-11-13 又补了第三个 Java 补丁 `java_patches/source_check_query_contract.patch`：`GET /api/v1/source/check/detail?monitorId=`（C01 单条读，带解析后的 checkConf 与 revision）、`GET /api/v1/source/check/runs` 与 `/run/{runId}`（C06 结构化运行记录，服务端解析 REMARKS/JOB_CONF，旧行标 `legacy` 且不补默认值）、`POST /api/v1/source/check/run`（C05 统一「立即运行」：规则检查走 Java 调度器，AI 检查转交本机执行器），以及 `sourceSummary` 补 `flowId` 与 `execState`。C05 的 AI 分支需要业务后端配置 `monitor.runner.base-url` 与 `monitor.runner.token`（值取执行器的 `RUNNER_ADMIN_TOKEN`）；没配置时接口明确回「本环境未配置监控执行器」，不会假装受理。186 已按同一套流程部署（jar 备份 `bee-config.jar.bak-c14-*`）。
监控发布须同时检查前端、Python Runner 和 Java 业务后端。空计划 AI 草稿保存依赖 `java_patches/ai_monitor_empty_schedule.patch`：需在目标环境对应的 Java 源码中合入并构建；仅把此补丁文件推送到前端仓库不会修改 Java 运行产物。上线前以目标环境表结构重新核对脚本时间字段，不能把 186 的脚本或字段选择直接视为 217 已验证；至少验收草稿保存、脚本试跑、保存后关闭弹窗及失败回执一致性。

运行详情的「冻结配置快照」依赖 `ck_job_log.JOB_CONF` 能放下完整 `CHECK_CONF`。AI 检查的 conf 含生成脚本（186 上约 12KB），该列原本是 `varchar(1000)` 且库的 `sql_mode` 为空，写入会被静默截断成半截 JSON，页面只能显示「未记录」。186 已于 2026-11-13 扩容为 `LONGTEXT`（脚本 `backend/sql/20261113_ck_job_log_job_conf_longtext.sql`）；其他环境部署前端前要先执行该脚本，否则运行详情继续显示「未记录」。历史日志里的半截数据不回填，解析失败按无快照处理。

字段候选由同一执行器的 `POST /api/runner-management/monitor-runner/table-fields` 查询业务库 `information_schema.COLUMNS`。接口缺失或查询失败时不回退到平台登记的业务字段；业务字段名可能实际映射到 `K1…K20`。执行器在试跑和正式执行前校验所选时间列，并注入 `DQ_TABLE_NAME`、`DQ_TIME_COLUMN`、`DQ_SOURCE_ID`、`DQ_START_DATE`、`DQ_END_DATE`。生成脚本应使用这些参数；有 `SOURCE_ID` 的共享表必须限定当前源。217 发布时需要同步部署此字段查询接口和新版前端；历史脚本不会因更改下拉框自动改写，必须重新生成并试跑。

默认使用本地 SQLite。需要临时 MySQL 时，先设置 `RUNNER_DB_HOST`、`RUNNER_DB_NAME`、`RUNNER_DB_USER`、`RUNNER_DB_PASSWORD` 环境变量再启动服务；MySQL 端口默认是 **8102**，如需更改可设置 `RUNNER_DB_PORT`。程序会创建六张 `ce_runner_` 前缀的表。不要把密码写进代码或仓库。

本机已恢复原 MySQL 连接，并保存于被 Git 忽略的 `backend/.runtime/runner-management.local.json`。后续仍在 `E:\ce` 执行 `python -m backend.runner_management.server`：未显式设置 MySQL 环境变量时，会自动读取该文件。密码使用 Windows DPAPI 加密，仅原 Windows 用户可解密；复制到其他机器需要重新配置连接或使用环境变量。配置损坏或无法解密时停止启动，不会悄悄改连空 SQLite。完整的 MySQL 环境变量优先于本机配置。

AI 代码生成服务另开一个终端启动；它需要有效的模型密钥，密钥只通过环境变量传入：

```powershell
$env:SITE_SCRIPT_AI_API_KEY='<模型密钥>'
python backend/legacy_qinlongclaw/site-script-service/server.py
```

前端开发服务器默认将 `/api/ai/site-script/` 代理到 `127.0.0.1:8091`。生产部署要分别配置 8091、8092 的反向代理路由和认证。

最简单的部署方式是把 `backend/runner_management` 整个文件夹复制到目标机器的任意目录（例如 `E:\runner-1`），在复制后的文件夹里运行：

```powershell
cd E:\runner-1
python start.py
```

也可以在 Windows 中双击文件夹里的 `启动Runner.cmd`。本机开发服务（`RUNNER_DEV_MODE=1`，只监听回环地址）首次运行会自动登记，不必输入登记码；之后在这个文件夹运行同一命令即可。实例身份、下载文件和日志位于文件夹内的 `instance` 子目录。第二个实例复制到另一个文件夹即可。如果管理服务不在本机，运行 `python start.py --server http://<管理服务地址>:8092`，并按提示输入管理页生成的一次性登记码。

Runner 会优先选择带网关的物理网卡地址，避免把 VPN 或虚拟网卡 IP 上报给管理页。多网卡机器如需固定地址，可在启动前设置 `RUNNER_ADVERTISE_IP` 环境变量（例如 `192.168.1.36`）；修改后重启 Runner，下一次心跳会更新管理页 IP。

Runner 默认每 5 秒上报一次心跳。后台每 5 秒检查一次；最后一次心跳超过 15 秒的实例会被标记为离线，恢复心跳后自动变回在线。实例列表每 5 秒刷新一次状态，手动点击「刷新」也会立即重新判定。

在「系统设置 → 队列分配」点击「新增分配」，直接在列表新行选择已有节点代码，再选择 Runner、测试/生产环境和并发数。队列与节点代码版本由所选代码记录确定，不再单独填写队列或选择处理程序版本；后台自动匹配已发布的 `newslink_nourl` 外壳，无可用版本时自动打包。Runner 会按分配下载已签名的 ZIP、验证、启动和监控子进程。`probe` 仍用于本地联调。`newslink_nourl` 是从旧项目迁入的实际队列处理程序，需要旧系统的 RabbitMQ、保存服务、浏览器和 Python 依赖配置才能接收真实业务任务。当前制品不自动安装其第三方依赖；本地有这些依赖时可临时设置 `RUNNER_DEV_SYSTEM_PACKAGES=1` 验证，正式部署应制作离线依赖包。

节点脚本在流程编辑器中生成并保存到代码仓库。新增队列分配时，后台将所选版本采用到该节点队列的指定运行环境；已有实例正在使用其他版本时，新增操作返回冲突提示，需选择已采用的版本，或先在「节点代码」显式发布新版本。分配记录关联逻辑代码项，列表展示该环境实际采用的代码路径、Git 提交和版本摘要，显式发布后会随环境绑定更新。处理程序从任务的 `ConfigId`、队列、环境和网站域名查询版本，优先使用站点代码，其次使用通用代码，并用摘要和签名校验下载内容；任务带有 `ScriptDigest` 时还会核对版本。脚本在单独的 Python 进程中运行，有 120 秒超时。旧任务没有 `ConfigId` 或节点没有采用脚本时，仍使用原有的按站点域名查找逻辑。

服务启动时自动为 SQLite 和 MySQL 的队列分配表补充 `code_id` 字段，保留已有分配。历史接口仍支持手工指定队列与处理程序制品，以兼容联调探针；节点脚本摘要 `scriptDigest` 与处理程序外壳摘要 `releaseDigest` 分开保存，不能互换。

`start.py` 会启动稳定的升级器：管理页发布 Runner 版本、设置实例目标版本后，它会下载签名包并做健康检查，启动失败则恢复上一版本。在尚未设置目标版本时，它直接运行文件夹内的 Runner 源码。

验证：

```powershell
python -m unittest backend.tests.test_runner_management -q
python -m compileall -q backend/runner_management backend/legacy_qinlongclaw
```
