# Preizkus pravil obvestil (pwsh ali Windows PowerShell). Zagon: pwsh -File deploy/lan/tests/test-notifier.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $here '..\notifier\nabava-obvestila.ps1') -NoRun
$fail = 0
function Check($name, $cond) { if ($cond) { Write-Host "ok   $name" } else { Write-Host "FAIL $name"; $script:fail++ } }

$json = @'
{"version":2,"users":[
 {"id":"u1","name":"Janez Vodja","role":"vodja","createdAt":"x"},
 {"id":"u2","name":"Marko","role":"delavec","workstationId":"ws-cnc","createdAt":"x"}],
 "requests":[
 {"id":"r1","createdAt":"2026-10-01T08:00:00.000Z","createdBy":"Marko","workstationId":"ws-cnc","title":"Frezer 10mm","urgency":"visoka","status":"odprto","history":[{"at":"2026-10-01T08:00:00.000Z","status":"odprto","by":"Marko"}]},
 {"id":"r2","createdAt":"2026-10-01T09:00:00.000Z","createdBy":"Ana","workstationId":"ws-rocna","title":"Vrtalo","urgency":"normalna","status":"naroceno","history":[{"at":"2026-10-01T10:00:00.000Z","status":"naroceno","by":"Janez Vodja"}]},
 {"id":"r3","createdAt":"2026-10-01T11:00:00.000Z","createdBy":"Marko","workstationId":"ws-cnc","title":"Kava","urgency":"nizka","status":"prejeto","history":[{"at":"2026-10-01T12:00:00.000Z","status":"prejeto","by":"Janez Vodja"}]},
 {"id":"r4","createdAt":"2026-10-01T13:00:00.000Z","createdBy":"Ana","title":"Zavrnjeno","urgency":"normalna","status":"zavrnjeno","history":[]}
 ]}
'@
$data = $json | ConvertFrom-Json

Check 'max stamp' ((Get-MaxStamp $data) -eq '2026-10-01T13:00:00.000Z')
$ev = @(Get-NotifEvents $data 'u1' 'delavec' '2026-10-01T08:30:00.000Z')
Check 'vodja: r2 in r3 (novi, odprti/narocena/prejeta... r3 prejeto ne)' ($ev.Count -eq 1 -and $ev[0].Id -eq 'new:r2:2026-10-01T09:00:00.000Z')
$ev = @(Get-NotifEvents $data 'u1' 'delavec' '')
Check 'vodja brez since: r1 (NUJNO) + r2' ($ev.Count -eq 2 -and $ev[1].Title -eq 'Nova zahteva · NUJNO')
Check 'vodja: sortirano novo najprej' ($ev[0].At -gt $ev[1].At)
$ev = @(Get-NotifEvents $data 'u2' 'vodja' '2026-10-01T00:00:00.000Z')
Check 'delavec Marko: samo r3 prejeto (r1 je odprto)' ($ev.Count -eq 1 -and $ev[0].Title -eq 'Status: Prejeto' -and $ev[0].Body -eq 'Kava')
$ev = @(Get-NotifEvents $data 'u2' 'vodja' '2026-10-01T12:00:00.000Z')
Check 'delavec: nic novega po 12:00' ($ev.Count -eq 0)
$ev = @(Get-NotifEvents $data 'neznan' 'vodja' '2026-10-01T08:30:00.000Z')
Check 'neznan uporabnik: rezervna vloga vodja' ($ev.Count -eq 1)
$ev = @(Get-NotifEvents ($null) 'u1' 'vodja' '')
Check 'prazni podatki brez napake' ($ev.Count -eq 0)

# Dictionary (JavaScriptSerializer-stil) enako kot PSCustomObject
$d = @{ users = @(@{ id = 'u1'; name = 'V'; role = 'vodja' }); requests = @(@{ id = 'x'; createdAt = '2026-10-02T00:00:00.000Z'; status = 'odprto'; title = 'T'; createdBy = 'A'; urgency = 'nizka' }) }
$ev = @(Get-NotifEvents $d 'u1' 'delavec' '2026-10-01T00:00:00.000Z')
Check 'hashtable podatki' ($ev.Count -eq 1)
Check 'To-Iso DateTime' ((To-Iso ([datetime]::Parse('2026-10-02T10:00:00Z').ToUniversalTime())) -eq '2026-10-02T10:00:00.000Z')

# Dictionary<string,object> kot ga vrne JavaScriptSerializer v Windows PowerShell 5.1 (Contains() je tam "explicit" -> napaka v v1.2.0/1.2.1)
$gd = New-Object 'System.Collections.Generic.Dictionary[string,object]'
$gd['id'] = 'u1'; $gd['name'] = 'Ana'
Check 'Get-Prop: Dictionary<string,object> obstojec kljuc' ((Get-Prop $gd 'name') -eq 'Ana')
Check 'Get-Prop: Dictionary<string,object> manjkajoc kljuc' ($null -eq (Get-Prop $gd 'ni'))
Check 'Get-Prop: Hashtable' ((Get-Prop @{ a = 1 } 'a') -eq 1 -and $null -eq (Get-Prop @{ a = 1 } 'b'))
Check 'Get-Prop: PSCustomObject' ((Get-Prop ([pscustomobject]@{ a = 5 }) 'a') -eq 5 -and $null -eq (Get-Prop ([pscustomobject]@{ a = 5 }) 'b'))
# prava pot kot v namestitvi: Parse-Json (JavaScriptSerializer v 5.1) + Get-Prop
$pj = Parse-Json $json
Check 'Parse-Json + Get-Prop users' (@(As-List (Get-Prop $pj 'users')).Count -eq 2 -and (Get-Prop (@(As-List (Get-Prop $pj 'users'))[0]) 'name') -eq 'Janez Vodja')
Check 'Parse-Json: Get-NotifEvents enak rezultat' (@(Get-NotifEvents $pj 'u1' 'delavec' '').Count -eq 2)
Check 'Parse-Json: manjkajoc kljuc (workstationId) brez napake' ($null -eq (Get-Prop (@(As-List (Get-Prop $pj 'users'))[0]) 'workstationId'))

# poskus XML-ja toasta ni mogoc brez Windows; preveri vsaj escape
Check 'Escape-Xml' ((Escape-Xml 'a<b>&"c') -eq 'a&lt;b&gt;&amp;&quot;c')

# ---- tok: seme -> brez obvestil; nova zahteva -> 1 obvestilo; ponovitev -> nic; stanje na disku
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('nabava-t-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
$script:DataDir = $tmp; $script:LogPath = Join-Path $tmp 'n.log'; $script:StatePath = Join-Path $tmp 's.json'
$script:Cfg = @{ serverUrl = 'http://x'; userId = 'u1'; userName = 'Janez Vodja'; role = 'vodja'; pollSeconds = 30 }
$script:State = Get-State
$script:LastHash = ''
$script:Shown = New-Object System.Collections.ArrayList
function Show-Notification([string]$Title, [string]$Body, [bool]$Urgent) { [void]$script:Shown.Add($Title + '|' + $Body); return 'ok' }
Handle-PollText $json
Check 'prvo branje: brez obvestil' ($script:Shown.Count -eq 0 -and $script:State.lastSeenAt -eq '2026-10-01T13:00:00.000Z')
$json2 = $json.Replace('"requests":[', '"requests":[{"id":"r9","createdAt":"2026-10-02T07:00:00.000Z","createdBy":"Ana","title":"Nov sveder","urgency":"visoka","status":"odprto","history":[]},')
Handle-PollText $json2
Check 'nova zahteva: 1 obvestilo (NUJNO)' ($script:Shown.Count -eq 1 -and $script:Shown[0] -eq 'Nova zahteva · NUJNO|Nov sveder · Ana')
Handle-PollText $json2
Check 'isti podatki: brez ponovitve' ($script:Shown.Count -eq 1)
$script:LastHash = ''
Handle-PollText $json2
Check 'brez zgodovine hasha: notifiedIds prepreci podvajanje' ($script:Shown.Count -eq 1)
$st2 = Get-State
Check 'stanje na disku' ($st2.userId -eq 'u1' -and $st2.lastSeenAt -eq '2026-10-02T07:00:00.000Z' -and $st2.notifiedIds.Count -eq 1)
Remove-Item -Recurse -Force $tmp
if ($fail -gt 0) { Write-Host "$fail NAPAK"; exit 1 } else { Write-Host 'VSE OK' }
