// Static script only: no renderer strings are interpolated into PowerShell.
export const windowsProbe = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$result=@{ steamPath=''; running=@(); paths=@(); media=@(); mediaError=$false }
if ($detectGames) { try { $steam=Get-ItemProperty -LiteralPath 'HKCU:\Software\Valve\Steam'; $result.steamPath=$steam.SteamPath
  $result.running=@(Get-ChildItem -LiteralPath 'HKCU:\Software\Valve\Steam\Apps' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty -LiteralPath $_.PSPath).Running -eq 1 } | ForEach-Object { $_.PSChildName })
} catch {}
try { $result.paths=@(Get-Process | ForEach-Object { try { if ($_.Path) { $_.Path } } catch {} }) } catch {} }
if ($detectMusic) { try {
 Add-Type -AssemblyName System.Runtime.WindowsRuntime
 $null=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
 $asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name.StartsWith('IAsyncOperation') } | Select-Object -First 1)
 function Wait-WinRT($operation,$type) { $task=$asTask.MakeGenericMethod($type).Invoke($null,@($operation)); if (-not $task.Wait(2500)) { throw 'Media timeout' }; return $task.Result }
 $manager=Wait-WinRT ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
 foreach($session in $manager.GetSessions()) {
   $source=$session.SourceAppUserModelId
   if ($source -notmatch 'Spotify|AppleMusic' -or $session.GetPlaybackInfo().PlaybackStatus.ToString() -ne 'Playing') { continue }
   $null=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
   $props=Wait-WinRT ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
   $result.media+=@{ source=$source; title=$props.Title; artist=$props.Artist; album=$props.AlbumTitle }
 }
} catch { $result.mediaError=$true } }
$result | ConvertTo-Json -Depth 4 -Compress
`;
