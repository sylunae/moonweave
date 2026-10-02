Add-Type -AssemblyName System.Drawing

$size = 256
$bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$lanePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(48, 42, 216, 255), 3)
$glowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(42, 42, 216, 255))
$noteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 56, 220, 255))
$highlightBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 190, 248, 255))
$lanes = @(28, 82, 136, 190)

foreach ($x in $lanes) {
  $graphics.DrawLine($lanePen, $x + 17, 22, $x + 17, 230)
}

function Draw-Note([int]$x, [int]$y, [int]$height) {
  $graphics.FillRectangle($glowBrush, $x - 7, $y - 7, 48, $height + 14)
  $graphics.FillRectangle($noteBrush, $x, $y, 34, $height)
  $graphics.FillRectangle($highlightBrush, $x + 4, $y + 4, 26, 5)
}

Draw-Note 28 170 24
Draw-Note 82 62 124
Draw-Note 136 100 24
Draw-Note 136 184 24
Draw-Note 190 116 92

$output = Join-Path (Split-Path $PSScriptRoot -Parent) 'public\assets\icons\4k-chart.png'
$directory = Split-Path $output -Parent
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)

$lanePen.Dispose()
$glowBrush.Dispose()
$noteBrush.Dispose()
$highlightBrush.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
