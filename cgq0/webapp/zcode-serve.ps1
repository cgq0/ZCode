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
  $env:GLM_BINARY_PATH = Join-Path $Webapp "agent\zcode.cjs"
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
    Write-Output "已停止（pid $existing）"
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
