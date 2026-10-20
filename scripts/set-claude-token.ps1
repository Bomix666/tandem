# Токен подписки Claude для писем: запускает `claude setup-token` (вход через
# браузер), просит вставить выданный токен (ввод скрыт), записывает его в .env
# как CLAUDE_CODE_OAUTH_TOKEN и перезапускает бота и приложение. Токен никуда
# не выводится и не логируется.
#
# Запуск: powershell -ExecutionPolicy Bypass -File scripts\set-claude-token.ps1
# Токен уже получен (вход прошёл) — только вставить: ... -File scripts\set-claude-token.ps1 -PasteOnly

param([switch]$PasteOnly)

$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root ".env"

if (-not $PasteOnly) {
  Write-Host ""
  Write-Host "ШАГ 1. Сейчас откроется браузер со входом в Claude — нажми там Authorize (Разрешить)." -ForegroundColor Cyan
  Write-Host "       Если браузер покажет код — скопируй его, вставь сюда и нажми Enter." -ForegroundColor Cyan
  Write-Host ""
  claude setup-token
  Write-Host ""
  Write-Host "ШАГ 2. Выше появился длинный токен — строка, которая начинается с sk-ant-oat." -ForegroundColor Cyan
  Write-Host "       Выдели её мышкой целиком и скопируй правой кнопкой мыши или Ctrl+Shift+C." -ForegroundColor Cyan
}
Write-Host ""
Write-Host "Вставь токен сюда (Ctrl+V или правая кнопка мыши), нажми Enter и потом ещё раз Enter." -ForegroundColor Cyan
Write-Host "Вставленный текст не виден — так и должно быть. Ctrl+C не нажимай: он останавливает скрипт." -ForegroundColor DarkGray

# при копировании токен мог разбиться на строки — читаем до пустой строки и склеиваем
$pasted = ""
while ($true) {
  $secure = Read-Host -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $part = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) -replace '\s', ''
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  if ($part) { $pasted += $part } elseif ($pasted) { break }
}
$token = [regex]::Match($pasted, 'sk-ant-oat[A-Za-z0-9_-]{30,}').Value

if (-not $token) {
  Write-Host "Не нашёл токен во вставленном (он начинается с sk-ant-oat). Ничего не записал — запусти скрипт ещё раз." -ForegroundColor Red
  exit 1
}

$line = "CLAUDE_CODE_OAUTH_TOKEN=`"$token`""
$text = [IO.File]::ReadAllText($envFile)
if ($text -match '(?m)^CLAUDE_CODE_OAUTH_TOKEN=') {
  $text = [regex]::Replace($text, '(?m)^CLAUDE_CODE_OAUTH_TOKEN=.*$', { param($m) $line })
} else {
  $text = $text.TrimEnd() + "`n# Токен подписки Claude (claude setup-token) — письма пишет Claude Code по подписке.`n$line`n"
}
[IO.File]::WriteAllText($envFile, $text)

Write-Host ""
Write-Host "Токен записан в .env. Перезапускаю бота и приложение..." -ForegroundColor Green
docker compose -f (Join-Path $root "docker-compose.yml") -f (Join-Path $root "docker-compose.tunnel.yml") up -d app bot cron
Write-Host ""
Write-Host "ГОТОВО. Напиши в чат «вставил» — я проверю письма." -ForegroundColor Green
