$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

# Build before reading the credential so the build never needs it.
Remove-Item Env:ROBLOX_SECURITY_COOKIE -ErrorAction SilentlyContinue
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'The cookie stays in this local process and the Node backend; it is not saved.'
Write-Host 'Authenticated polling runs every 5 seconds with a 12 requests/minute cap. Ctrl+C stops the app.'
$sessionSecret = Read-Host 'Paste only your .ROBLOSECURITY value (hidden)' -AsSecureString
if ($sessionSecret.Length -eq 0) {
    $sessionSecret.Dispose()
    throw 'No cookie supplied. Use npm start for anonymous mode.'
}
$secretPointer = [IntPtr]::Zero
try {
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sessionSecret)
    $env:ROBLOX_SECURITY_COOKIE = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    $secretPointer = [IntPtr]::Zero
    & node src/server/index.js
    $appExitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:ROBLOX_SECURITY_COOKIE -ErrorAction SilentlyContinue
    if ($secretPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    }
    $sessionSecret.Dispose()
}
exit $appExitCode
