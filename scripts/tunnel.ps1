# Публичный HTTPS-адрес для Mini App через localhost.run (ssh, без регистрации).
# Cloudflare quick tunnel под VPN пользователя не подключается, поэтому так.
#
# Держит ssh-туннель к http://localhost:3000. Когда адрес меняется — пишет его
# в .env (TELEGRAM_WEBAPP_URL, APP_URL) и пересоздаёт app/bot/cron; бот при
# старте сам ставит кнопку меню на новый адрес. Если туннель упал или отдаёт
# ошибку — поднимает заново.
#
# Запуск: powershell -ExecutionPolicy Bypass -File scripts\tunnel.ps1

# один экземпляр: автозапуск и ручной запуск не должны драться за туннель
$mutex = New-Object Threading.Mutex($false, "Local\TandemTunnel")
if (-not $mutex.WaitOne(0)) { exit }

$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root ".env"
$log = Join-Path $env:TEMP "tandem-tunnel.log"
$compose = @("compose", "-f", (Join-Path $root "docker-compose.yml"), "-f", (Join-Path $root "docker-compose.tunnel.yml"))

function Test-Url($url) {
  try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20).StatusCode -eq 200 } catch { return $false }
}

function Get-TunnelUrl {
  $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.lhr\.life" -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($m) { return $m.Matches[0].Value } else { return $null }
}

function Set-AppUrl($url) {
  $text = [IO.File]::ReadAllText($envFile)
  if ($text -match "(?m)^TELEGRAM_WEBAPP_URL=$([regex]::Escape($url))\s*$") { return }
  $text = $text -replace "(?m)^(TELEGRAM_WEBAPP_URL|APP_URL)=.*$", "`$1=$url"
  [IO.File]::WriteAllText($envFile, $text)
  & docker @compose up -d app bot cron | Out-Null
  Write-Host "$(Get-Date -Format HH:mm:ss) адрес: $url"
}

$dockerDesktop = Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"

while ($true) {
  # ждём приложение; после перезагрузки Docker Desktop сам не стартует — запускаем
  # его, контейнеры поднимутся сами (restart: unless-stopped)
  while (-not (Test-Url "http://localhost:3000")) {
    if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue) -and (Test-Path $dockerDesktop)) { Start-Process $dockerDesktop }
    Start-Sleep -Seconds 10
  }

  Remove-Item $log, "$log.err" -ErrorAction SilentlyContinue
  $ssh = Start-Process ssh -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" -ArgumentList @(
    "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes", "-R", "80:localhost:3000", "nokey@localhost.run")

  $fails = 0
  while (-not $ssh.HasExited -and $fails -lt 3) {
    Start-Sleep -Seconds 20
    $url = Get-TunnelUrl
    if (-not $url) { $fails++; continue }
    Set-AppUrl $url
    if (Test-Url $url) { $fails = 0 } else { $fails++ }
  }
  if (-not $ssh.HasExited) { Stop-Process -Id $ssh.Id -Force -ErrorAction SilentlyContinue }
  Write-Host "$(Get-Date -Format HH:mm:ss) туннель упал — поднимаю заново"
  Start-Sleep -Seconds 5
}
