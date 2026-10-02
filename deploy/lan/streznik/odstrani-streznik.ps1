# Nabava Orodjarna - odstranitev STREZNIKA (podatki v mapi data\ ostanejo!). Zazene jo ODSTRANI-STREZNIK.bat.
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
$Title = 'Nabava strežnik'
$nl = [Environment]::NewLine
try {
  $markerFile = Join-Path $env:LOCALAPPDATA 'NabavaOrodjarna\streznik-mapa.txt'
  $root = 'C:\NabavaOrodjarna'
  if (Test-Path -LiteralPath $markerFile) { $root = (Get-Content -LiteralPath $markerFile -TotalCount 1 -Encoding UTF8).Trim() }
  $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'start-streznik\.ps1' }
  foreach ($p in @($procs)) { if ($p.ProcessId -ne $PID) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } }
  $nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'server[\\/]index\.js' }
  foreach ($p in @($nodes)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath 'schtasks.exe' -ArgumentList '/Delete /TN "NabavaOrodjarna Streznik" /F' -Wait -WindowStyle Hidden
  $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Nabava streznik.lnk'
  if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force }
  & netsh advfirewall firewall delete rule name=NabavaOrodjarna-8787 *> $null
  [void][System.Windows.Forms.MessageBox]::Show('Strežnik je ustavljen in samodejni zagon odstranjen.' + $nl + 'Podatki ostanejo v: ' + $root + '\data' + $nl + '(mapo lahko pobrišeš ročno, če res ne rabiš podatkov.)', $Title)
} catch {
  [void][System.Windows.Forms.MessageBox]::Show(('Odstranitev ni uspela: ' + $_), $Title)
}
