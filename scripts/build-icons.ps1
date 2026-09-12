$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot 'SolSeer Icon.png'
$outputDirectory = Join-Path $projectRoot 'public'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$source = [Drawing.Image]::FromFile($sourcePath)
$frames = @()
try {
    foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
        $bitmap = New-Object Drawing.Bitmap($size, $size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $stream = New-Object IO.MemoryStream
        try {
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
            $width = [int][Math]::Round($source.Width * $scale)
            $height = [int][Math]::Round($source.Height * $scale)
            $graphics.DrawImage($source, [int](($size-$width)/2), [int](($size-$height)/2), $width, $height)
            $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
            $bytes = $stream.ToArray()
            $frames += @{ Size = $size; Bytes = $bytes }
            if ($size -eq 256) { [IO.File]::WriteAllBytes((Join-Path $outputDirectory 'solseer-icon.png'), $bytes) }
        } finally { $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose() }
    }
    $ico = New-Object IO.MemoryStream
    $writer = New-Object IO.BinaryWriter($ico)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
            $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
            $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$frame.Bytes.Length); $writer.Write([uint32]$offset)
            $offset += $frame.Bytes.Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Bytes) }
        [IO.File]::WriteAllBytes((Join-Path $outputDirectory 'solseer.ico'), $ico.ToArray())
    } finally { $writer.Dispose(); $ico.Dispose() }
} finally { $source.Dispose() }
Write-Output 'Generated public/solseer.ico and public/solseer-icon.png from SolSeer Icon.png'
