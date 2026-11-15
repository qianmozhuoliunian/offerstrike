# Export the GPT-generated artwork to web PNG and Windows ICO sizes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$brandRoot = Split-Path -Parent $PSScriptRoot
$brandSource = [System.Drawing.Image]::FromFile((Join-Path $brandRoot 'public/assets/offerstrike-original.png'))
$brandFrames = @()
try {
  foreach ($brandSize in @(16, 32, 48, 64, 128, 256)) {
    $brandBitmap = New-Object System.Drawing.Bitmap($brandSize, $brandSize)
    $brandGraphics = [System.Drawing.Graphics]::FromImage($brandBitmap)
    $brandStream = New-Object System.IO.MemoryStream
    try {
      $brandGraphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $brandGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $brandGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $brandGraphics.DrawImage($brandSource, 0, 0, $brandSize, $brandSize)
      $brandBitmap.Save($brandStream, [System.Drawing.Imaging.ImageFormat]::Png)
      $brandBytes = $brandStream.ToArray()
      $brandFrames += [pscustomobject]@{ Size = $brandSize; Bytes = $brandBytes }
      if ($brandSize -eq 256) {
        [System.IO.File]::WriteAllBytes((Join-Path $brandRoot 'public/assets/offerstrike-icon.png'), $brandBytes)
      }
    } finally {
      $brandGraphics.Dispose()
      $brandBitmap.Dispose()
      $brandStream.Dispose()
    }
  }
  $brandOutput = [System.IO.File]::Create((Join-Path $brandRoot 'public/assets/offerstrike.ico'))
  $brandWriter = New-Object System.IO.BinaryWriter($brandOutput)
  try {
    $brandWriter.Write([uint16]0)
    $brandWriter.Write([uint16]1)
    $brandWriter.Write([uint16]$brandFrames.Count)
    $brandOffset = 6 + 16 * $brandFrames.Count
    foreach ($brandFrame in $brandFrames) {
      $brandDimension = if ($brandFrame.Size -eq 256) { 0 } else { $brandFrame.Size }
      $brandWriter.Write([byte]$brandDimension)
      $brandWriter.Write([byte]$brandDimension)
      $brandWriter.Write([byte]0)
      $brandWriter.Write([byte]0)
      $brandWriter.Write([uint16]1)
      $brandWriter.Write([uint16]32)
      $brandWriter.Write([uint32]$brandFrame.Bytes.Length)
      $brandWriter.Write([uint32]$brandOffset)
      $brandOffset += $brandFrame.Bytes.Length
    }
    foreach ($brandFrame in $brandFrames) { $brandWriter.Write([byte[]]$brandFrame.Bytes) }
  } finally { $brandWriter.Dispose() }
} finally { $brandSource.Dispose() }
Write-Output 'Exported OfferStrike PNG and multi-size ICO.'
