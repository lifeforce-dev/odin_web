param(
  [string]$RootPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$ManifestPath = (Join-Path $PSScriptRoot "manifest.json"),
  [string]$Title = "Odin Design Previewer",
  [string]$Description = "Auto-discovered design preview manifest."
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-RelativePath {
  param(
    [string]$BasePath,
    [string]$TargetPath
  )

  $resolvedBase = (Resolve-Path $BasePath).Path.TrimEnd('\\')
  $resolvedTarget = (Resolve-Path $TargetPath).Path

  if ($resolvedTarget.StartsWith($resolvedBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    $relative = $resolvedTarget.Substring($resolvedBase.Length)
    $relative = $relative -replace '^[\\/]+', ''
    return "./" + ($relative -replace '\\', '/')
  }

  $baseUri = New-Object System.Uri(($resolvedBase + "\\"))
  $targetUri = New-Object System.Uri($resolvedTarget)
  $relativeUri = $baseUri.MakeRelativeUri($targetUri)
  return "./" + ([System.Uri]::UnescapeDataString($relativeUri.ToString()) -replace '\\', '/')
}

function ConvertTo-TitleCaseWords {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $Value
  }

  $parts = @($Value -split '[-_]+' | Where-Object { $_ -ne "" })
  if ($parts.Count -eq 0) {
    return $Value
  }

  $converted = foreach ($part in $parts) {
    if ($part -match '^[0-9]+$') {
      $part
      continue
    }

    switch ($part.ToLowerInvariant()) {
      "gpt" { "GPT"; continue }
      "claude" { "Claude"; continue }
      "gemini" { "Gemini"; continue }
      "rts" { "RTS"; continue }
      default {
        $lower = $part.ToLowerInvariant()
        ($lower.Substring(0,1).ToUpperInvariant() + $lower.Substring(1))
      }
    }
  }

  return ($converted -join ' ')
}

function ConvertTo-FileTitle {
  param([string]$FileName)

  $stem = [System.IO.Path]::GetFileNameWithoutExtension($FileName)

  if ($stem -match '^design-(\d+)-(.*)$') {
    $num = $Matches[1]
    $rest = ConvertTo-TitleCaseWords -Value $Matches[2]
    return "$num - $rest"
  }

  if ($stem -match '^(\d+)-(.*)$') {
    $num = $Matches[1]
    $rest = ConvertTo-TitleCaseWords -Value $Matches[2]
    return "$num - $rest"
  }

  return ConvertTo-TitleCaseWords -Value $stem
}

function Get-GroupLabelFromFolder {
  param([string]$FolderName)

  $raw = $FolderName
  if ($raw -match '^designs[_\- ]?(.*)$') {
    $suffix = $Matches[1]
    if (-not [string]::IsNullOrWhiteSpace($suffix)) {
      return ConvertTo-TitleCaseWords -Value $suffix
    }
  }

  return ConvertTo-TitleCaseWords -Value $raw
}

function BuildGroup {
  param(
    [System.IO.DirectoryInfo]$GroupDir,
    [string]$BasePath
  )

  $htmlFiles = Get-ChildItem -Path $GroupDir.FullName -File -Filter "*.html" |
    Where-Object { $_.Name -ne "index.html" } |
    Sort-Object Name

  $items = @()
  foreach ($file in $htmlFiles) {
    $items += [ordered]@{
      title = ConvertTo-FileTitle -FileName $file.Name
      path = Get-RelativePath -BasePath $BasePath -TargetPath $file.FullName
    }
  }

  if ($items.Count -eq 0) {
    return $null
  }

  return [ordered]@{
    key = $GroupDir.Name
    label = Get-GroupLabelFromFolder -FolderName $GroupDir.Name
    items = $items
  }
}

$root = Resolve-Path $RootPath

$versionDirs = @(Get-ChildItem -Path $root.Path -Directory |
  Where-Object { $_.Name -match '^v\d+$' } |
  Sort-Object Name)

$versions = @()

if ($versionDirs.Count -gt 0) {
  foreach ($versionDir in $versionDirs) {
    $groupDirs = @(Get-ChildItem -Path $versionDir.FullName -Directory | Sort-Object Name)

    $groups = @()
    foreach ($groupDir in $groupDirs) {
      $group = BuildGroup -GroupDir $groupDir -BasePath $root.Path
      if ($null -ne $group) {
        $groups += $group
      }
    }

    if ($groups.Count -eq 0) {
      continue
    }

    $versions += [ordered]@{
      key = $versionDir.Name.ToLowerInvariant()
      label = $versionDir.Name.ToUpperInvariant()
      groups = $groups
    }
  }
}
else {
  $groupDirs = @(Get-ChildItem -Path $root.Path -Directory |
    Where-Object { $_.Name -like 'designs*' } |
    Sort-Object Name)

  $groups = @()
  foreach ($groupDir in $groupDirs) {
    $group = BuildGroup -GroupDir $groupDir -BasePath $root.Path
    if ($null -ne $group) {
      $groups += $group
    }
  }

  if ($groups.Count -gt 0) {
    $versions += [ordered]@{
      key = "v1"
      label = "V1"
      groups = $groups
    }
  }
}

$manifest = [ordered]@{
  title = $Title
  description = $Description
  generatedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
  rootPath = $root.Path
  versions = $versions
}

$manifestJson = $manifest | ConvertTo-Json -Depth 8
$manifestJson | Set-Content -Path $ManifestPath -Encoding UTF8

Write-Host "Manifest written:" $ManifestPath
Write-Host "Versions discovered:" $versions.Count
