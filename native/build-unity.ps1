param([string]$UnityEditor)
$ErrorActionPreference = 'Stop'
$nativeRoot = $PSScriptRoot
if (-not $UnityEditor) {
    $editors = Get-ChildItem 'C:\Program Files\Unity\Hub\Editor' -Directory -ErrorAction SilentlyContinue
    $preferred = $editors | Where-Object Name -Like '2022.3*' | Sort-Object Name -Descending | Select-Object -First 1
    if (-not $preferred) { $preferred = $editors | Sort-Object Name -Descending | Select-Object -First 1 }
    if ($preferred) { $UnityEditor = Join-Path $preferred.FullName 'Editor\Unity.exe' }
}
if (-not $UnityEditor -or -not (Test-Path -LiteralPath $UnityEditor)) { throw 'Unity Editor が見つかりません。Unity Hub で Windows Build Support を含む Editor を導入するか -UnityEditor で指定してください。' }
$projectPath = Join-Path $nativeRoot 'Tonarium.Unity'
$logPath = Join-Path $projectPath 'build.log'
$process = Start-Process -FilePath $UnityEditor -ArgumentList @('-batchmode','-nographics','-quit','-projectPath',('"' + $projectPath + '"'),'-executeMethod','Tonarium.UnityClient.Editor.WindowsBuild.Build','-logFile',('"' + $logPath + '"')) -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) { Get-Content -LiteralPath $logPath -Tail 60; throw "Unity build failed ($($process.ExitCode))" }
Write-Output (Join-Path $nativeRoot 'build\unity\Tonarium3D.exe')
