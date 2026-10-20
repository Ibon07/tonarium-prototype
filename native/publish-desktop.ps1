param([string]$Runtime = 'win-x64', [switch]$SkipUnity)
$ErrorActionPreference = 'Stop'
$sdk = Join-Path $env:LOCALAPPDATA 'Tonarium\dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $sdk)) { $sdk = (Get-Command dotnet -ErrorAction Stop).Source }
$env:DOTNET_ROOT = Split-Path $sdk -Parent
if (-not $SkipUnity) { & (Join-Path $PSScriptRoot 'build-unity.ps1'); if ($LASTEXITCODE -ne 0) { throw 'Unity build failed' } }
$destination = Join-Path $PSScriptRoot "artifacts\Tonarium-$Runtime"
& $sdk publish (Join-Path $PSScriptRoot 'Tonarium.Desktop\Tonarium.Desktop.csproj') -c Release -r $Runtime --self-contained true -o $destination --nologo
if ($LASTEXITCODE -ne 0) { throw 'Desktop publish failed' }
$unity = Join-Path $PSScriptRoot 'build\unity'
if (Test-Path -LiteralPath $unity) { Copy-Item -LiteralPath $unity -Destination (Join-Path $destination 'Unity') -Recurse -Force }
Write-Output (Join-Path $destination 'Tonarium.exe')
