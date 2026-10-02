# Nabava Orodjarna - odstranitev obvestil s tega PC-ja. Zazene jo ODSTRANI-OBVESTILA.bat.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
$Title = 'Nabava obvestila'
$base = Join-Path $env:LOCALAPPDATA 'NabavaOrodjarna'
try {
  $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'nabava-obvestila\.ps1|nabava-notifier\.ps1' }
  foreach ($p in @($procs)) { if ($p.ProcessId -ne $PID) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } }
  Start-Sleep -Milliseconds 700
  $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Nabava obvestila.lnk'
  if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
  $key = 'HKCU:\Software\Classes\AppUserModelId\Nabava.Orodjarna.Obvestila'
  if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force }
  $dir = Join-Path $base 'notifier'
  if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
  $st = Join-Path $base 'notifier-state.json'
  if (Test-Path -LiteralPath $st) { Remove-Item -LiteralPath $st -Force }
  [void][System.Windows.Forms.MessageBox]::Show('Obvestila so odstranjena s tega računalnika.', $Title)
} catch {
  [void][System.Windows.Forms.MessageBox]::Show(('Odstranitev ni uspela: ' + $_), $Title)
}
