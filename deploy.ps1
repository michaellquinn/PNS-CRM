# Deploy to Substrait from Windows.
#
# Why this exists: the plugin's /substrait:deploy falls back to Compress-Archive on
# Windows PowerShell 5.1, which writes ZIP entry names with BACKSLASHES. That is
# off-spec, so the platform's Linux-side validator sees one file literally named
# "cicd\Dockerfile.backend" instead of a cicd/ directory, and rejects the upload with
# "no backend Dockerfile found".
#
# This builds the zip with explicit forward-slash entry names via System.IO.Compression,
# then POSTs it with curl.exe. Delete this file once the plugin ships a fix, or once
# 'zip' is on PATH in Git Bash (which makes the plugin take its correct primary path).
#
# ASCII only: PS 5.1 reads .ps1 as ANSI unless there is a BOM, and mangled multibyte
# characters break the parser.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$cfg  = Get-Content (Join-Path $root '.substrait\config.json') -Raw | ConvertFrom-Json
$zip  = Join-Path $env:TEMP ("substrait-" + [guid]::NewGuid().ToString('N').Substring(0,8) + ".zip")

# Source only - the platform discards build output and enforces a 16 MB cap.
$skipDirs  = @('.git','node_modules','.venv','venv','__pycache__','dist','build','.substrait')
$skipFiles = @('.DS_Store','deploy.ps1')

$files = Get-ChildItem $root -Recurse -File -Force | Where-Object {
    $rel   = $_.FullName.Substring($root.Length + 1)
    $parts = $rel -split '\\'
    -not ($parts | Where-Object { $skipDirs -contains $_ }) -and
    $skipFiles -notcontains $_.Name -and
    $_.Extension -ne '.pyc'
}

$fs      = [System.IO.File]::Open($zip, 'Create')
$archive = New-Object System.IO.Compression.ZipArchive($fs, 'Create')
try {
    foreach ($f in $files) {
        # The whole point: forward slashes, as the ZIP spec requires.
        $name  = $f.FullName.Substring($root.Length + 1).Replace('\', '/')
        $entry = $archive.CreateEntry($name, 'Optimal')
        $in    = [System.IO.File]::OpenRead($f.FullName)
        $out   = $entry.Open()
        try { $in.CopyTo($out) } finally { $out.Dispose(); $in.Dispose() }
        Write-Host ("  + " + $name)
    }
} finally { $archive.Dispose(); $fs.Dispose() }

$kb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host ""
Write-Host ("Packaged " + $kb + " KB (" + $files.Count + " files) with forward-slash entries.")
Write-Host ("Uploading to " + $cfg.portal_url + "/api/deploy ...")

# curl.exe rather than Invoke-RestMethod: -Form needs PowerShell 6+, and this is 5.1.
# A native Windows path here means no MSYS translation to go wrong.
$body = & curl.exe -sS -X POST -H ("Authorization: Bearer " + $cfg.token) -F ("file=@" + $zip + ";type=application/zip;filename=upload.zip") -F "backend_stack=fastapi" ($cfg.portal_url + "/api/deploy")

Remove-Item $zip -Force -ErrorAction SilentlyContinue

if (-not $body) {
    Write-Host "Upload failed: empty response."
    exit 1
}

$resp = $null
try {
    $resp = $body | ConvertFrom-Json
} catch {
    Write-Host "Upload failed - raw response:"
    Write-Host $body
    exit 1
}

if ($resp.run_id) {
    Write-Host ("Deploy queued - run #" + $resp.run_id + ".")
    Write-Host ("Preview: https://" + $cfg.host)
    Write-Host "Portal:  https://app.substrait.build"
} else {
    Write-Host "Upload rejected:"
    Write-Host $body
    exit 1
}
