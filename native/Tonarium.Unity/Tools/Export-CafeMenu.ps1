$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$source = Get-Content -LiteralPath (Join-Path $repo 'client\src\view3d\worlds3d.tsx') -Raw -Encoding UTF8
$items = [regex]::Matches($source, "\['([^']+)', '(¥[^']+)'\]")
if ($items.Count -ne 4) { throw 'Web MenuBoard has changed; update the canvas export.' }
$bitmap = New-Object Drawing.Bitmap 1024,640
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([Drawing.ColorTranslator]::FromHtml('#2c3a33'))
$border = New-Object Drawing.Pen ([Drawing.ColorTranslator]::FromHtml('#a07a52')),24
$graphics.DrawRectangle($border,12,12,1000,616)
$ink = New-Object Drawing.SolidBrush ([Drawing.ColorTranslator]::FromHtml('#f4ecd8'))
$titleFont = New-Object Drawing.Font 'Segoe UI',84,([Drawing.FontStyle]::Bold),([Drawing.GraphicsUnit]::Pixel)
$menuFont = New-Object Drawing.Font 'Segoe UI',48,([Drawing.FontStyle]::Regular),([Drawing.GraphicsUnit]::Pixel)
$format = [Drawing.StringFormat]::GenericTypographic.Clone()
$format.FormatFlags = $format.FormatFlags -bor [Drawing.StringFormatFlags]::NoWrap
function Draw-CanvasText([string]$value,[Drawing.Font]$font,[float]$x,[float]$baseline,[string]$align) {
    $ascent = $font.Size * $font.FontFamily.GetCellAscent($font.Style) / $font.FontFamily.GetEmHeight($font.Style)
    $width = $graphics.MeasureString($value,$font,10000,$format).Width
    if ($align -eq 'center') { $x -= $width/2 }
    if ($align -eq 'right') { $x -= $width }
    $graphics.DrawString($value,$font,$ink,[Drawing.PointF]::new($x,$baseline-$ascent),$format)
}
Draw-CanvasText 'Café Tonarium' $titleFont 512 130 'center'
for ($i=0;$i -lt $items.Count;$i++) {
    Draw-CanvasText $items[$i].Groups[1].Value $menuFont 120 (250+$i*88) 'left'
    Draw-CanvasText $items[$i].Groups[2].Value $menuFont 904 (250+$i*88) 'right'
}
$output = Join-Path $repo 'native\Tonarium.Unity\Assets\Resources\CafeMenu.png'
$bitmap.Save($output,[Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose(); $border.Dispose(); $ink.Dispose(); $titleFont.Dispose(); $menuFont.Dispose(); $format.Dispose()
Write-Output $output
