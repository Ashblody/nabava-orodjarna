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
$script:ShownMeta = New-Object System.Collections.ArrayList
$script:MutedUntil = [datetime]::MinValue
function Show-Notification([string]$Title, [string]$Body, [bool]$Urgent, [string]$Url = '') { [void]$script:Shown.Add($Title + '|' + $Body); [void]$script:ShownMeta.Add(@{ Urgent = $Urgent; Url = $Url }); return 'ok' }
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

# ---- klepet + Kaj se mudi: GET /api/notify/poll (v1.4.0)
$script:Cfg = @{ serverUrl = 'http://192.168.1.124:8787'; userId = 'u 2'; userName = 'Marko'; role = 'delavec'; pollSeconds = 30; chatPollSeconds = 4 }
$script:StatePath = Join-Path $tmp 's2.json'
$script:State = Get-State
Check 'novo stanje: chatSeq/boardSeq = -1' ($script:State.chatSeq -eq -1 -and $script:State.boardSeq -eq -1)
Check 'poll URL brez stanja: brez since (prvi zagon), uporabnik kodiran' ((Get-ChatPollUrl) -eq 'http://192.168.1.124:8787/api/notify/poll?user=u%202')
function Reset-Shown { $script:Shown.Clear(); $script:ShownMeta.Clear() }
Reset-Shown
$n = Handle-ChatPollText '{"seq":10,"bseq":3,"items":[]}'
Check 'prvi zagon: brez toastov, zapomni seq + bseq' ($n -eq 0 -and $script:Shown.Count -eq 0 -and $script:State.chatSeq -eq 10 -and $script:State.boardSeq -eq 3)
Check 'poll URL po semenjenju: since=10&bsince=3' ((Get-ChatPollUrl) -eq 'http://192.168.1.124:8787/api/notify/poll?user=u%202&since=10&bsince=3')
$disk = Get-State
Check 'stanje na disku: seq ostane po ponovnem zagonu' ($disk.chatSeq -eq 10 -and $disk.boardSeq -eq 3 -and $disk.chatUser -eq 'u 2')

$poll1 = '{"seq":13,"bseq":4,"items":[' +
  '{"kind":"chat","seq":11,"channel":"plani","title":"Plani · Ana","body":"Jutri rezkamo","machine":"","nujno":false,"url":"/#/klepet/plani"},' +
  '{"kind":"chat","seq":12,"channel":"nujno","title":"Nujno · Ana","body":"Stroj stoji","machine":"Okuma Genos","nujno":true,"url":"/#/klepet/nujno"},' +
  '{"kind":"chat","seq":13,"channel":"dm:a|b","title":"Ana","body":"Zasebno","machine":"","nujno":false,"url":"/#/klepet/dm%3Aa%7Cb"},' +
  '{"kind":"board","seq":4,"channel":"mudi","title":"Kaj se mudi · Ana","body":"DN 24-1 · Gorenje — Danes","machine":"","nujno":true,"url":"/#/mudi"}]}'
$n = Handle-ChatPollText $poll1
Check 'nova sporocila + mudi: 4 toasti' ($n -eq 4 -and $script:Shown.Count -eq 4)
Check 'toast: naslov|besedilo' ($script:Shown[0] -eq 'Plani · Ana|Jutri rezkamo' -and $script:Shown[2] -eq 'Ana|Zasebno')
Check 'toast Nujno: poseben zvok (Urgent) + oznaka stroja' ($script:ShownMeta[1].Urgent -eq $true -and $script:Shown[1] -eq 'Nujno · Ana|[Okuma Genos] Stroj stoji' -and $script:ShownMeta[0].Urgent -eq $false)
Check 'klik odpre #/klepet/<kanal> (celoten URL)' ($script:ShownMeta[0].Url -eq 'http://192.168.1.124:8787/#/klepet/plani' -and $script:ShownMeta[2].Url -eq 'http://192.168.1.124:8787/#/klepet/dm%3Aa%7Cb')
Check 'toast Kaj se mudi: URL #/mudi, nujno' ($script:ShownMeta[3].Url -eq 'http://192.168.1.124:8787/#/mudi' -and $script:ShownMeta[3].Urgent -eq $true)
Check 'seq se premakne' ($script:State.chatSeq -eq 13 -and $script:State.boardSeq -eq 4)
Reset-Shown
$n = Handle-ChatPollText $poll1
Check 'isti odgovor ponovno: brez podvojenih toastov' ($n -eq 0 -and $script:Shown.Count -eq 0)
$n = Handle-ChatPollText '{"seq":13,"bseq":4,"items":[]}'
Check 'prazen odgovor: nic' ($n -eq 0)

# veliko sporocil: 4 + povzetek
$many = New-Object System.Collections.ArrayList
for ($i = 14; $i -le 23; $i++) { [void]$many.Add('{"kind":"chat","seq":' + $i + ',"channel":"razno","title":"Razno · Ana","body":"m' + $i + '","machine":"","nujno":false,"url":"/#/klepet/razno"}') }
Reset-Shown
$n = Handle-ChatPollText ('{"seq":23,"bseq":4,"items":[' + ($many -join ',') + ']}')
Check 'poplava: 4 toasti + 1 povzetek "Še 6"' ($n -eq 5 -and $script:Shown.Count -eq 5 -and $script:Shown[4] -eq 'Nabava|Še 6 novih sporočil.')

# utisano: brez toastov, a stevci se premaknejo (ni zaostanka po koncu utisanja)
Reset-Shown
$script:MutedUntil = (Get-Date).AddHours(1)
$n = Handle-ChatPollText '{"seq":25,"bseq":4,"items":[{"kind":"chat","seq":24,"channel":"nujno","title":"Nujno · Ana","body":"x","machine":"","nujno":true,"url":"/#/klepet/nujno"},{"kind":"chat","seq":25,"channel":"nujno","title":"Nujno · Ana","body":"y","machine":"","nujno":true,"url":"/#/klepet/nujno"}]}'
Check 'utisano: brez toastov, seq naprej' ($n -eq 0 -and $script:Shown.Count -eq 0 -and $script:State.chatSeq -eq 25)
$script:MutedUntil = [datetime]::MinValue

# streznik ponastavljen (manjsi seq): nadaljuj, nov seq se sprejme
Reset-Shown
$n = Handle-ChatPollText '{"seq":2,"bseq":0,"items":[]}'
Check 'streznik ponastavljen: seq se spusti, brez toastov' ($n -eq 0 -and $script:State.chatSeq -eq 2 -and $script:State.boardSeq -eq 0)
$n = Handle-ChatPollText '{"seq":3,"bseq":0,"items":[{"kind":"chat","seq":3,"channel":"splosno","title":"Splošno · Ana","body":"po ponastavitvi","machine":"","nujno":false,"url":"/#/klepet/splosno"}]}'
Check 'po ponastavitvi: novo sporocilo se pokaze' ($n -eq 1 -and $script:Shown[0] -eq 'Splošno · Ana|po ponastavitvi')

# drug uporabnik na istem PC: ponovno semenjenje (brez poplave)
Reset-Shown
$script:Cfg.userId = 'u3'
Check 'drug uporabnik: poll URL spet brez since' ((Get-ChatPollUrl) -notmatch 'since=')
$n = Handle-ChatPollText '{"seq":50,"bseq":9,"items":[{"kind":"chat","seq":49,"channel":"razno","title":"Razno · Ana","body":"staro","machine":"","nujno":false,"url":"/#/klepet/razno"}]}'
Check 'drug uporabnik: brez toastov, seq prevzet' ($n -eq 0 -and $script:Shown.Count -eq 0 -and $script:State.chatSeq -eq 50 -and $script:State.chatUser -eq 'u3')

# JavaScriptSerializer vrne Dictionary<string,object> / ArrayList / Int32 (Windows PowerShell 5.1): isti rezultat, brez Contains()
$script:Cfg.userId = 'u3'
Reset-Shown
$dict = New-Object 'System.Collections.Generic.Dictionary[string,object]'
$item = New-Object 'System.Collections.Generic.Dictionary[string,object]'
$item['kind'] = 'chat'; $item['seq'] = [int]51; $item['channel'] = 'plani'; $item['title'] = 'Plani · Ana'; $item['body'] = 'dict'; $item['machine'] = ''; $item['nujno'] = $false; $item['url'] = '/#/klepet/plani'
$al = New-Object System.Collections.ArrayList
[void]$al.Add($item)
$dict['seq'] = [int]51; $dict['bseq'] = [int]9; $dict['items'] = $al
function Parse-Json([string]$text) { return $script:FakeParsed }
$script:FakeParsed = $dict
$n = Handle-ChatPollText 'x'
Check 'Dictionary<string,object> odgovor: 1 toast' ($n -eq 1 -and $script:Shown[0] -eq 'Plani · Ana|dict' -and $script:State.chatSeq -eq 51)

# ---- statika: brez konstruktov, ki jih Windows PowerShell 5.1 ne pozna
$bad = New-Object System.Collections.ArrayList
foreach ($f in @('nabava-obvestila.ps1', 'namesti-obvestila.ps1', 'odstrani-obvestila.ps1')) {
  $path = Join-Path (Join-Path $here '..\notifier') $f
  $ln = 0
  foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
    $ln++
    $code = $line -replace "'[^']*'", "''" -replace '"[^"]*"', '""' -replace '#.*$', ''
    if ($code -match '\?\?|\?\.|\)\s*&&|\)\s*\|\||\sif\s*\(.*\)\s*\?\s|ForEach-Object\s+-Parallel|-AsHashtable|-AsByteStream|UTF8NoBOM|-SkipCertificateCheck|-NoNewline\b.*ConvertTo|\bclean\s*\{|\.Contains\(') {
      [void]$bad.Add($f + ':' + $ln + ' ' + $line.Trim())
    }
  }
}
Check ('brez PowerShell 7 konstruktov v skriptah obvestil ' + ($bad -join ' || ')) ($bad.Count -eq 0)
Remove-Item -Recurse -Force $tmp
if ($fail -gt 0) { Write-Host "$fail NAPAK"; exit 1 } else { Write-Host 'VSE OK' }
