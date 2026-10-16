param([switch]$StartTunnel)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$config = Join-Path $runtime 'cloudflared.yml'
$metadataPath = Join-Path $runtime 'remote-processes.json'
$gatewayScript = [IO.Path]::GetFullPath((Join-Path $root 'lib\remote-gateway.mjs'))
$node = (Get-Command node.exe -ErrorAction Stop).Source
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
function Read-Health([string]$Url,[string]$HostHeader) { try { $response=Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers @{Host=$HostHeader} -TimeoutSec 2;if($response.StatusCode -ne 200){return $null};return $response.Content|ConvertFrom-Json } catch { return $null } }
function Test-StudioReady { $health=Read-Health 'http://127.0.0.1:8826/api/health' '127.0.0.1:8826';return $null -ne $health -and $health.ok -eq $true -and $health.provider -eq 'codex' }
function Test-GatewayReady { $health=Read-Health 'http://127.0.0.1:8830/healthz' '127.0.0.1:8830';return $null -ne $health -and $health.ok -eq $true -and $health.service -eq 'ceo-studio-gateway' }
function Get-OwnedProcess([int]$ProcessId,[string]$Executable,[string]$CommandMarker) { if($ProcessId -le 0){return $null};$process=Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue;if(!$process){return $null};if([IO.Path]::GetFullPath($process.ExecutablePath) -ne [IO.Path]::GetFullPath($Executable)){return $null};if($process.CommandLine -notlike "*$CommandMarker*"){return $null};return $process }
function Get-ProcessIdValue($Process) { if($null -eq $Process){return $null};if($null -ne $Process.Id){return [int]$Process.Id};if($null -ne $Process.ProcessId){return [int]$Process.ProcessId};throw 'Process object has no Id or ProcessId.' }
function Wait-Ready([scriptblock]$Probe,[int]$Attempts=30) { for($i=0;$i -lt $Attempts;$i++){if(& $Probe){return $true};Start-Sleep -Milliseconds 250};return $false }
if (!(Test-Path -LiteralPath (Join-Path $runtime 'remote-auth.bin') -PathType Leaf)) { throw 'Run remote-auth-store.ps1 -Mode setup first.' }
if (!(Test-StudioReady)) { throw 'CEO Studio on 127.0.0.1:8826 is not ready.' }
if ($StartTunnel -and !(Test-Path -LiteralPath $config -PathType Leaf)) { throw 'Missing .runtime/cloudflared.yml.' }
if ($StartTunnel -and !(Test-Path -LiteralPath $cloudflared -PathType Leaf)) { throw 'cloudflared is missing.' }
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$saved=$null;if(Test-Path -LiteralPath $metadataPath -PathType Leaf){try{$saved=Get-Content -LiteralPath $metadataPath -Raw|ConvertFrom-Json}catch{$saved=$null}}
$gatewayProcess=if($saved){Get-OwnedProcess ([int]$saved.gatewayPid) $node $gatewayScript}else{$null};$gatewayStarted=$false
if(!$gatewayProcess -or !(Test-GatewayReady)){if($gatewayProcess){throw 'The recorded gateway process exists but is not healthy. Stop it manually after verifying its identity.'};$gatewayProcess=Start-Process -FilePath $node -ArgumentList @($gatewayScript) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'gateway.stdout.log') -RedirectStandardError (Join-Path $runtime 'gateway.stderr.log') -PassThru;$gatewayStarted=$true;if(!(Wait-Ready {Test-GatewayReady}) -or $gatewayProcess.HasExited){Stop-Process -Id (Get-ProcessIdValue $gatewayProcess) -ErrorAction SilentlyContinue;throw 'Gateway failed its readiness check.'}}
$tunnelProcess=if($saved -and $saved.tunnelPid){Get-OwnedProcess ([int]$saved.tunnelPid) $cloudflared $config}else{$null}
if($StartTunnel -and !$tunnelProcess){try{$tunnelProcess=Start-Process -FilePath $cloudflared -ArgumentList @('tunnel','--config',$config,'run') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'cloudflared.stdout.log') -RedirectStandardError (Join-Path $runtime 'cloudflared.stderr.log') -PassThru;Start-Sleep -Seconds 2;if($tunnelProcess.HasExited){throw 'cloudflared exited during startup.'}}catch{if($gatewayStarted){Stop-Process -Id (Get-ProcessIdValue $gatewayProcess) -ErrorAction SilentlyContinue};throw}}
$metadata=@{gatewayPid=(Get-ProcessIdValue $gatewayProcess);tunnelPid=(Get-ProcessIdValue $tunnelProcess);gatewayReady=$true;tunnelRequested=[bool]$StartTunnel;startedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json
[IO.File]::WriteAllText($metadataPath,$metadata,[Text.UTF8Encoding]::new($false))
Write-Output $(if($StartTunnel){'REMOTE_GATEWAY_AND_TUNNEL_READY'}else{'REMOTE_GATEWAY_READY_TUNNEL_NOT_STARTED'})
