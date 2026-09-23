Add-Type -AssemblyName System.Drawing

function Draw-Icon([int]$size, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Background gradient #1F2749 to #0E1222
    $c1 = [System.Drawing.Color]::FromArgb(31, 39, 73)
    $c2 = [System.Drawing.Color]::FromArgb(14, 18, 34)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, [float]45.0)
    
    # Rounded rect background
    $radius = [int]($size * 0.22)
    $path_bg = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path_bg.AddArc(0, 0, $d, $d, 180, 90)
    $path_bg.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path_bg.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path_bg.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path_bg.CloseFigure()
    $g.FillPath($brush, $path_bg)

    # Scale factor
    $scale = [float]($size / 512.0)

    # Draw Amber Moon
    $amber = [System.Drawing.Color]::FromArgb(242, 166, 90)
    $amberBrush = New-Object System.Drawing.SolidBrush($amber)
    $moonPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $moonPath.AddEllipse([float](165 * $scale), [float](135 * $scale), [float](210 * $scale), [float](210 * $scale))
    $clipPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $clipPath.AddEllipse([float](215 * $scale), [float](105 * $scale), [float](190 * $scale), [float](190 * $scale))
    
    # Exclude inner circle to make crescent
    $moonRegion = New-Object System.Drawing.Region($moonPath)
    $moonRegion.Exclude($clipPath)
    $g.FillRegion($amberBrush, $moonRegion)

    # Location Pin Head
    $pinBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 243, 237))
    $g.FillEllipse($pinBrush, [float](225 * $scale), [float](180 * $scale), [float](62 * $scale), [float](62 * $scale))
    
    # Pin Point Triangle
    $p1 = New-Object System.Drawing.PointF([float](226 * $scale), [float](220 * $scale))
    $p2 = New-Object System.Drawing.PointF([float](286 * $scale), [float](220 * $scale))
    $p3 = New-Object System.Drawing.PointF([float](256 * $scale), [float](275 * $scale))
    [System.Drawing.PointF[]]$pts = @($p1, $p2, $p3)
    $g.FillPolygon($pinBrush, $pts)

    # Pin Inner Dark & Amber Glow
    $darkBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 27, 51))
    $g.FillEllipse($darkBrush, [float](241 * $scale), [float](196 * $scale), [float](30 * $scale), [float](30 * $scale))
    $g.FillEllipse($amberBrush, [float](249 * $scale), [float](204 * $scale), [float](14 * $scale), [float](14 * $scale))

    # Transit wave line at bottom #3D8577
    $tealPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(61, 133, 119), [float](10 * $scale))
    $tealPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $tealPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawBezier($tealPen, [float](130 * $scale), [float](400 * $scale), [float](200 * $scale), [float](360 * $scale), [float](310 * $scale), [float](360 * $scale), [float](380 * $scale), [float](400 * $scale))

    # Transit Waypoints
    $g.FillEllipse($amberBrush, [float](150 * $scale), [float](385 * $scale), [float](14 * $scale), [float](14 * $scale))
    $g.FillEllipse($pinBrush, [float](249 * $scale), [float](353 * $scale), [float](14 * $scale), [float](14 * $scale))
    $tealBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(61, 133, 119))
    $g.FillEllipse($tealBrush, [float](350 * $scale), [float](385 * $scale), [float](14 * $scale), [float](14 * $scale))

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Successfully generated $path"
}

$iconsDir = Join-Path $PSScriptRoot "..\public\icons"
if (-not (Test-Path $iconsDir)) { New-Item -ItemType Directory -Path $iconsDir -Force }

Draw-Icon 512 (Join-Path $iconsDir "icon-512.png")
Draw-Icon 192 (Join-Path $iconsDir "icon-192.png")
Draw-Icon 180 (Join-Path $iconsDir "apple-touch-icon.png")
