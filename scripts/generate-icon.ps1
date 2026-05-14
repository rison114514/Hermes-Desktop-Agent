param(
  [string]$OutputDir = "assets"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-IconBitmap {
  param([int]$Size)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $scale = $Size / 1024.0
  function S([float]$Value) { return [int][Math]::Round($Value * $scale) }
  function F([float]$Value) { return [float]($Value * $scale) }

  $graphics.Clear([System.Drawing.Color]::Transparent)

  $outer = [System.Drawing.Rectangle]::new((S 82), (S 82), (S 860), (S 860))
  $outerPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRectangle $outerPath $outer (S 214)
  $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $outer,
    [System.Drawing.Color]::FromArgb(255, 23, 32, 51),
    [System.Drawing.Color]::FromArgb(255, 12, 17, 29),
    135
  )
  $graphics.FillPath($bgBrush, $outerPath)

  $edgePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 56, 189, 248), (F 34))
  $inner = [System.Drawing.Rectangle]::new((S 112), (S 112), (S 800), (S 800))
  $innerPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRectangle $innerPath $inner (S 188)
  $graphics.DrawPath($edgePen, $innerPath)

  $panel = [System.Drawing.Rectangle]::new((S 238), (S 263), (S 548), (S 498))
  $panelPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  Add-RoundedRectangle $panelPath $panel (S 57)
  $panelBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 7, 17, 31))
  $panelPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 38, 52, 73), (F 18))
  $graphics.FillPath($panelBrush, $panelPath)
  $graphics.DrawPath($panelPen, $panelPath)

  $glyphColor = [System.Drawing.Color]::FromArgb(255, 125, 211, 252)
  $accentColor = [System.Drawing.Color]::FromArgb(255, 251, 191, 36)
  $glyphPen = [System.Drawing.Pen]::new($glyphColor, (F 62))
  $glyphPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glyphPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $glyphPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $accentPen = [System.Drawing.Pen]::new($accentColor, (F 62))
  $accentPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $accentPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $points = @(
    [System.Drawing.PointF]::new((F 334), (F 389)),
    [System.Drawing.PointF]::new((F 430), (F 512)),
    [System.Drawing.PointF]::new((F 334), (F 635))
  )
  $graphics.DrawLines($glyphPen, $points)
  $graphics.DrawLine($glyphPen, (F 542), (F 389), (F 542), (F 635))
  $graphics.DrawLine($glyphPen, (F 667), (F 389), (F 667), (F 635))
  $graphics.DrawLine($glyphPen, (F 542), (F 512), (F 667), (F 512))
  $graphics.DrawLine($accentPen, (F 491), (F 631), (F 693), (F 631))

  foreach ($item in @($bgBrush, $edgePen, $panelBrush, $panelPen, $glyphPen, $accentPen, $outerPath, $innerPath, $panelPath, $graphics)) {
    $item.Dispose()
  }

  return $bitmap
}

function Add-RoundedRectangle {
  param(
    [System.Drawing.Drawing2D.GraphicsPath]$Path,
    [System.Drawing.Rectangle]$Rect,
    [int]$Radius
  )

  $diameter = $Radius * 2
  $arc = [System.Drawing.Rectangle]::new($Rect.X, $Rect.Y, $diameter, $diameter)
  $Path.AddArc($arc, 180, 90)
  $arc.X = $Rect.Right - $diameter
  $Path.AddArc($arc, 270, 90)
  $arc.Y = $Rect.Bottom - $diameter
  $Path.AddArc($arc, 0, 90)
  $arc.X = $Rect.X
  $Path.AddArc($arc, 90, 90)
  $Path.CloseFigure()
}

function Save-Png {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Path
  )

  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Write-Ico {
  param(
    [string[]]$PngPaths,
    [string]$OutputPath
  )

  $images = @($PngPaths | ForEach-Object { ,[System.IO.File]::ReadAllBytes($_) })
  $stream = [System.IO.File]::Create($OutputPath)
  $writer = [System.IO.BinaryWriter]::new($stream)

  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)

    $offset = 6 + (16 * $images.Count)
    for ($i = 0; $i -lt $images.Count; $i++) {
      $size = [int]([System.IO.Path]::GetFileNameWithoutExtension($PngPaths[$i]) -replace '^icon-', '')
      $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
      $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$images[$i].Length)
      $writer.Write([UInt32]$offset)
      $offset += $images[$i].Length
    }

    foreach ($image in $images) {
      $writer.Write($image)
    }
  } finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$resolvedOutputDir = Join-Path (Resolve-Path -LiteralPath ".").Path $OutputDir
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$pngPaths = foreach ($size in $sizes) {
  $bitmap = New-IconBitmap -Size $size
  try {
    $path = Join-Path $resolvedOutputDir "icon-$size.png"
    Save-Png -Bitmap $bitmap -Path $path
    $path
  } finally {
    $bitmap.Dispose()
  }
}

Copy-Item -LiteralPath (Join-Path $resolvedOutputDir "icon-256.png") -Destination (Join-Path $resolvedOutputDir "icon.png") -Force
Write-Ico -PngPaths $pngPaths -OutputPath (Join-Path $resolvedOutputDir "icon.ico")
Write-Host "Generated icon assets in $resolvedOutputDir"
