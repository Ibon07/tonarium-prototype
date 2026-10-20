param([string]$Runtime = 'win-x64', [switch]$SkipUnity)
$ErrorActionPreference = 'Stop'
$sdk = Join-Path $env:LOCALAPPDATA 'Tonarium\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $sdk)) { $sdk = (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_ROOT = Split-Path $sdk -Parent
if (-not $SkipUnity) { & (Join-Path $PSScriptRoot 'build-unity.ps1') }
$destination = Join-Path $PSScriptRoot "artifacts\Tonarium-$Runtime"
& $sdk publish (Join-Path $PSScriptRoot 'Tonarium.Desktop\Tonarium.Desktop.csproj') -c Release -r $Runtime --self-contained true -o $destination --nologo
if ($LASTEXITCODE -ne 0) { throw 'Desktop publish failed' }
$unity = Join-Path $PSScriptRoot 'build\unity'
if (Test-Path -LiteralPath $unity) {
    $unityDestination = Join-Path $destination 'Unity'
    New-Item -ItemType Directory -Path $unityDestination -Force | Out-Null
    Get-ChildItem -LiteralPath $unity | Copy-Item -Destination $unityDestination -Recurse -Force
}
$publishRoot = [IO.Path]::GetFullPath($destination).TrimEnd('\') + '\'
$unusedArchitectures = if ($Runtime -eq 'win-x64') { @('win-x86', 'win-arm64') } elseif ($Runtime -eq 'win-arm64') { @('win-x86', 'win-x64') } else { @() }
foreach ($architecture in $unusedArchitectures) {
    $unused = [IO.Path]::GetFullPath((Join-Path $destination "libvlc\$architecture"))
    if (-not $unused.StartsWith($publishRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid publish cleanup path' }
    if (Test-Path -LiteralPath $unused) { Remove-Item -LiteralPath $unused -Recurse -Force }
}
foreach ($symbols in Get-ChildItem -LiteralPath $destination -Recurse -File -Filter '*.pdb') {
    if (-not $symbols.FullName.StartsWith($publishRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid symbol cleanup path' }
    Remove-Item -LiteralPath $symbols.FullName -Force
}
Write-Output (Join-Path $destination 'Tonarium.exe')
