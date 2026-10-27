# zcode-serve — ZCode Web 自托管服务启停（Windows PowerShell 版，与 zcode-webapp/ 同目录）。
#
# 用法：
#   .\zcode-serve.ps1 start [-HostBind 127.0.0.1] [-Port 3030] [-Token <auth-token>]
#   .\zcode-serve.ps1 stop      # 幂等：没在跑也返回成功
#   .\zcode-serve.ps1 status
#   .\zcode-serve.ps1 run       # 前台运行（调试）
#
# 行为与 sh 版一致：start 隐藏窗口后台启动（SSH 断开不亡）；进程管理只认 pid 文件；
# 数据写用户 ~\.zcode。Node 优先用随包 zcode-webapp\node\node.exe，缺失回退系统 node。
param(
  [Parameter(Position = 0)][string]$Command = "start",
  [string]$HostBind = "127.0.0.1",
  [int]$Port = 3030,
  [string]$Token = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Webapp = Join-Path $ScriptDir "zcode-webapp"
$ServerCjs = Join-Path $Webapp "zcode-web-server.cjs"
$StateDir = Join-Path $env:USERPROFILE ".zcode\webapp"
$PidFile = Join-Path $StateDir "zcode-serve.pid"
$LogFile = Join-Path $StateDir "zcode-serve.log"

$BundledNode = Join-Path $Webapp "node\node.exe"
if (Test-Path $BundledNode) { $NodeBin = $BundledNode } else { $NodeBin = "node" }

if (-not (Test-Path $ServerCjs)) {
  Write-Error "缺少 $ServerCjs（zcode-serve.ps1 需与 zcode-webapp\ 同目录）"
}
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Read-ServePid {
  if (Test-Path $PidFile) {
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed)) { return $parsed }
  }
  return $null
}

function Test-Alive([int]$Id) {
  try { Get-Process -Id $Id -ErrorAction Stop | Out-Null; return $true } catch { return $false }
}

function Test-HttpReady {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/server-info" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false }
}

function Apply-Env {
  $env:PORT = "$Port"
  $env:ZCODE_SERVER_HOST = $HostBind
  $env:ZCODE_WEB_STATIC_ROOT = Join-Path $Webapp "web"
  # agent 启动用显式命令语义（server 端 agent resolver 第一优先级），不能用
  # GLM_BINARY_PATH——它指向 .cjs 会被 resolver 当"原生二进制"直接 spawn，
  # Windows 直接 spawn EFTYPE（2026-10-27 win 实测：发消息必败，日志
  # sendConversationCommandV4 FAIL Error: spawn EFTYPE，UI 报"草稿会话创建
  # 失败"；sh 版同因，两处必须同步改）。改为 spawn 随包 node 跑 agent bundle。
  # ARGS_JSON 路径必须正斜杠：JSON 反斜杠是非法转义（实测 Bad escaped
  # character in JSON），Node Windows 接受正斜杠。
  $AgentCjs = (Join-Path $Webapp "agent\zcode.cjs") -replace '\\', '/'
  $env:ZCODE_AGENT_SERVER_COMMAND = $NodeBin
  $env:ZCODE_AGENT_SERVER_ARGS_JSON = "[`"$AgentCjs`",`"app-server`",`"--stdio`"]"
  if ($Token) { $env:ZCODE_SERVER_AUTH_TOKEN = $Token }
}

switch ($Command) {
  "start" {
    $existing = Read-ServePid
    if ($existing -and (Test-Alive $existing)) {
      Write-Output "已在运行（pid $existing），跳过启动"
      return
    }
    if ($existing) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
    # 无 pid 记录但端口已有响应（可能是手工启动/改版前的残留实例）：直接失败。
    # 否则新实例因端口占用退出前，就绪探测会命中旧实例而误报"已启动"（实测踩坑，
    # 与 sh 版 947e1a25 修复同步的防护）。
    if (Test-HttpReady) {
      Write-Error "端口 $Port 已被其他进程占用（无本启动器 pid 记录）；请先找到该进程停止，或换 -Port"
    }
    Apply-Env
    $process = Start-Process -FilePath $NodeBin -ArgumentList "`"$ServerCjs`"" `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err"
    Set-Content -Path $PidFile -Value $process.Id
    for ($i = 0; $i -lt 20; $i++) {
      if (-not (Test-Alive $process.Id)) {
        Write-Error "进程退出，查看日志：$LogFile / $LogFile.err"
      }
      if (Test-HttpReady) {
        Write-Output "已启动：http://$HostBind`:$Port（pid $($process.Id)，后台隐藏窗口）"
        Write-Output "日志：$LogFile；停止：.\zcode-serve.ps1 stop"
        return
      }
      Start-Sleep -Seconds 1
    }
    Write-Output "进程运行中（pid $($process.Id)）但 http 未就绪，查看日志：$LogFile"
  }
  "stop" {
    $existing = Read-ServePid
    if (-not $existing -or -not (Test-Alive $existing)) {
      if ($existing) { Remove-Item $PidFile -Force -ErrorAction SilentlyContinue }
      Write-Output "未在运行"
      return
    }
    Stop-Process -Id $existing -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 10 -and (Test-Alive $existing); $i++) { Start-Sleep -Seconds 1 }
    if (Test-Alive $existing) { Stop-Process -Id $existing -Force -ErrorAction SilentlyContinue }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    # 停止后必须确认端口真释放：仍有响应说明存在 pid 文件之外的实例占着端口，如实报告。
    if (Test-HttpReady) {
      Write-Output "已停止（pid $existing），但端口 $Port 仍有服务响应——存在 pid 文件之外的实例，请手动排查"
    } else {
      Write-Output "已停止（pid $existing）"
    }
  }
  "status" {
    $existing = Read-ServePid
    if (-not $existing -or -not (Test-Alive $existing)) {
      Write-Output "状态：未运行"
      return
    }
    $ready = if (Test-HttpReady) { "正常" } else { "未就绪" }
    Write-Output "状态：运行中（pid $existing，端口 $Port 探测 $ready）"
  }
  "run" {
    Apply-Env
    & $NodeBin $ServerCjs
  }
  default {
    Write-Error "未知命令：$Command（支持 start/stop/status/run）"
  }
}
