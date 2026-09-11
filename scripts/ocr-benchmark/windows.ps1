param([string]$Inputs, [string]$Output)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$metadata = Join-Path $env:WINDIR 'System32/WinMetadata'
$references = @('Windows.Foundation.winmd','Windows.Globalization.winmd','Windows.Graphics.winmd','Windows.Media.winmd','Windows.Storage.winmd' | ForEach-Object { '/reference:' + (Join-Path $metadata $_) })
$references += @('System.Runtime.WindowsRuntime.dll','System.Runtime.dll','System.Drawing.dll','System.Web.Extensions.dll' | ForEach-Object { '/reference:' + (Join-Path $framework $_) })
$exe = Join-Path $root '.data/ocr-benchmark/windows.exe'
New-Item -ItemType Directory -Path (Split-Path $exe) -Force | Out-Null
& (Join-Path $framework 'csc.exe') /nologo /target:exe /optimize+ /main:OcrBenchmark ('/out:' + $exe) $references (Join-Path $root 'scripts/windows-screen-helper.cs') (Join-Path $PSScriptRoot 'windows.cs')
if ($LASTEXITCODE -ne 0) { throw 'Benchmark compile failed' }
& $exe $Inputs $Output
if ($LASTEXITCODE -ne 0) { throw 'Windows OCR benchmark failed' }
