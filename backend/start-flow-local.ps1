param(
    [string]$BeeRoot = 'E:\bee-top',
    [string]$JavaHome = $env:JAVA_HOME,
    [int]$Port = 8090,
    [string]$RemoteAuthTarget = 'http://118.25.96.217:9999'
)
$ErrorActionPreference = 'Stop'
if (-not $env:BEE_DB_PASSWORD) { throw '请通过 BEE_DB_PASSWORD 环境变量提供数据库密码。' }
$classpathFile = Join-Path $BeeRoot 'bee-config\target\runtime-classpath.txt'
if (-not (Test-Path -LiteralPath $classpathFile)) { throw '请先构建原项目并生成 bee-config/target/runtime-classpath.txt。' }
$modules = @('bee-config', 'bee-base', 'bee-comm', 'bee-flow', 'bee-scheduler', 'bee-file')
$classes = $modules | ForEach-Object {
    $path = Join-Path $BeeRoot "$_\target\classes"
    if (-not (Test-Path -LiteralPath $path)) { throw "缺少原模块编译产物：$path" }
    $path
}
$moduleJars = $modules | ForEach-Object { "$_-1.0-SNAPSHOT.jar" }
$dependencies = ((Get-Content -LiteralPath $classpathFile -Raw).Trim() -split ';') | Where-Object { (Split-Path $_ -Leaf) -notin $moduleJars }
$classpath = (($classes + $dependencies) -join ';')
$runtime = Join-Path $BeeRoot 'logs\local-flow'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$env:SPRING_DATASOURCE_URL = if ($env:BEE_DB_URL) { $env:BEE_DB_URL } else { 'jdbc:mysql://192.168.1.30:8102/app001?useUnicode=true&characterEncoding=UTF-8&useSSL=false' }
$env:SPRING_DATASOURCE_USERNAME = if ($env:BEE_DB_USER) { $env:BEE_DB_USER } else { 'app001' }
$env:SPRING_DATASOURCE_PASSWORD = $env:BEE_DB_PASSWORD
$env:SPRING_DATASOURCE_DRUID_INITIAL_SIZE = '1'
$env:SPRING_DATASOURCE_DRUID_MIN_IDLE = '1'
$env:SPRING_FLYWAY_ENABLED = 'false'
$env:APP_NO_CONSUMER = 'true'
$env:SCHEDULE_TASK_ENABLE = 'false'
$env:APP_LOCAL_CACHE_DISABLED = 'true'
$env:APP_LOCAL_FLOW_REMOTE_AUTH_TARGET = $RemoteAuthTarget
$java = if ($JavaHome) { Join-Path $JavaHome 'bin\java.exe' } else { (Get-Command java.exe -ErrorAction Stop).Source }
$arguments = @('-Dspring.devtools.restart.enabled=false', '-cp', ('"' + $classpath + '"'), 'com.vanv.BeeConfigApplication', '--server.address=127.0.0.1', "--server.port=$Port", '--spring.profiles.active=test2')
$process = Start-Process -FilePath $java -ArgumentList $arguments -WorkingDirectory $runtime -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'out.log') -RedirectStandardError (Join-Path $runtime 'err.log') -PassThru
$process.Id | Set-Content -LiteralPath (Join-Path $runtime 'server.pid')
Write-Output "原模块服务已启动：PID $($process.Id)，http://127.0.0.1:$Port；日志：$runtime"
