param([string]$HelperPath = (Join-Path $PSScriptRoot '../native/solseer-screen-helper.exe'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assembly = [Reflection.Assembly]::LoadFile((Resolve-Path $HelperPath).Path)
$helper = $assembly.GetType('SolseerScreenHelper')
$flags = [Reflection.BindingFlags]'NonPublic,Static'
$extract = $helper.GetMethod('ExtractColorChannel', $flags)
$score = $helper.GetMethod('BiomeScore', $flags)
foreach ($channel in 0..2) {
    $pixels = [byte[]]::new(16 * 16 * 4)
    for ($pixel = 0; $pixel -lt 256; $pixel++) {
        $pixels[$pixel * 4 + $channel] = if ($pixel % 16 -lt 8) { 20 } else { 24 }
        $pixels[$pixel * 4 + 3] = 255
    }
    $result = $extract.Invoke($null, @($pixels, 16, [Drawing.Size]::new(16, 16), $channel))
    if ($result[0] -ne 0 -or $result[8 * 4] -ne 255 -or $result[3] -ne 255) {
        throw "Channel $channel failed low-contrast separation"
    }
}
$flat = $extract.Invoke($null, @([byte[]]::new(16 * 16 * 4), 16, [Drawing.Size]::new(16, 16), 0))
if ($flat[0] -ne 255) { throw 'Flat channel handling failed' }
foreach ($label in @('[INCINERATOR]', '[SAND STORM]', 'SINGULAR1TY', 'PUMPKIN MOON')) {
    if ($score.Invoke($null, @($label)) -lt 0.70) { throw "Expected a matching biome: $label" }
}
foreach ($label in @('', 'xy', 'xxxxxxxxxxxxxxx')) {
    if ($score.Invoke($null, @($label)) -ge 0.70) { throw 'Invalid text incorrectly accepted' }
}
Write-Output 'RGB extraction, faint/flat channels, and biome scoring checks passed.'
