// Static script only: no renderer strings are interpolated into PowerShell.
export const windowsProbe = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$result=@{ steamPath=''; running=@(); paths=@(); media=@(); mediaError=$false }
if ($detectDevelopment) { try {
 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class AnnoyForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process); }'
 $activeEditorProcess=[uint32]0
 $null=[AnnoyForeground]::GetWindowThreadProcessId([AnnoyForeground]::GetForegroundWindow(),[ref]$activeEditorProcess)
 $result.editors=@(Get-Process | Where-Object { $_.ProcessName -match '^(Code|Code - Insiders|idea64|idea|pycharm64|dbeaver|ssms|devenv)$' -and $_.MainWindowTitle } | ForEach-Object { @{ process=$_.ProcessName; title=$_.MainWindowTitle; active=($_.Id -eq $activeEditorProcess) } })
} catch { $result.editors=@() } }
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
   $artwork=''
   if ($props.Thumbnail) {
     $thumbnailStream=$null; $managedStream=$null; $memory=$null; $sourceImage=$null; $bitmap=$null; $graphics=$null; $output=$null
     try {
       $null=[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
       $thumbnailStream=Wait-WinRT ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
       # Reflection preserves the WinRT interface when PowerShell exposes only System.__ComObject.
       $asStream=([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1)
       $managedStream=$asStream.Invoke($null,@($thumbnailStream))
       if ($managedStream.Length -gt 0 -and $managedStream.Length -le 524288) {
           Add-Type -AssemblyName System.Drawing
           $memory=[System.IO.MemoryStream]::new()
           $managedStream.CopyTo($memory); $memory.Position=0
           $sourceImage=[System.Drawing.Image]::FromStream($memory)
           $scale=[Math]::Min(1.0,160.0/[Math]::Max($sourceImage.Width,$sourceImage.Height))
           $bitmap=[System.Drawing.Bitmap]::new([Math]::Max(1,[int]($sourceImage.Width*$scale)),[Math]::Max(1,[int]($sourceImage.Height*$scale)))
           $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
           $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
           $graphics.DrawImage($sourceImage,0,0,$bitmap.Width,$bitmap.Height)
           $output=[System.IO.MemoryStream]::new()
           $bitmap.Save($output,[System.Drawing.Imaging.ImageFormat]::Jpeg)
           if ($output.Length -le 16000) { $artwork='data:image/jpeg;base64,'+[Convert]::ToBase64String($output.ToArray()) }
       }
     } catch { # Artwork is optional; retain the track if Windows provides no usable thumbnail.
     } finally {
       foreach($resource in @($graphics,$bitmap,$sourceImage,$memory,$output,$managedStream,$thumbnailStream)) { if ($resource) { try { $resource.Dispose() } catch {} } }
     }
   }
   $result.media+=@{ source=$source; title=$props.Title; artist=$props.Artist; album=$props.AlbumTitle; artwork=$artwork }
 }
} catch { $result.mediaError=$true } }
$result | ConvertTo-Json -Depth 4 -Compress
`;
