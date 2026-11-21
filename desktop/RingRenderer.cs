using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using Microsoft.Win32;

namespace TokkenMaxing;

public sealed record RingTheme(Color Track, Color Arc)
{
    /// <summary>Dark taskbar: light arc on a mid-grey track.</summary>
    public static readonly RingTheme TrayDark = new(Palette.ToColor("#4B5563"), Palette.ToColor("#F8FAFC"));

    /// <summary>Light taskbar: dark arc on a light-grey track.</summary>
    public static readonly RingTheme TrayLight = new(Palette.ToColor("#CBD5E1"), Palette.ToColor("#0F172A"));

    /// <summary>Dashboard / phone app (dark UI).</summary>
    public static readonly RingTheme App = new(Palette.ToColor("#334155"), Palette.ToColor("#F8FAFC"));

    public static RingTheme ForTaskbar() => TaskbarIsLight() ? TrayLight : TrayDark;

    public static bool TaskbarIsLight()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("SystemUsesLightTheme") is int v && v == 1;
        }
        catch
        {
            return false;
        }
    }
}

/// <summary>
/// Draws the TokkenMaxing ring: a disc colored by pace (see Palette), surrounded by a ring whose
/// arc is the plan usage (clockwise from 12 o'clock). Beyond 100 %, a second lap is drawn in gold.
/// The white dot on the ring (marker) is where the usage should be right now to reach the objective.
/// Geometry matches mobile/src/ring.ts.
/// </summary>
public static class RingRenderer
{
    public const float TrayThickness = 0.17f;
    public const float LargeThickness = 0.085f;

    public static void Draw(Graphics g, RectangleF bounds, double progress, Color disc, RingTheme theme,
        double? marker = null, float thickness = LargeThickness)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;

        var size = Math.Min(bounds.Width, bounds.Height);
        var cx = bounds.X + bounds.Width / 2f;
        var cy = bounds.Y + bounds.Height / 2f;
        var outer = size / 2f * 0.97f;
        var width = size * thickness;
        var center = outer - width / 2f;
        var gap = size * 0.05f;
        var discRadius = outer - width - gap;

        using (var brush = new SolidBrush(disc))
            g.FillEllipse(brush, cx - discRadius, cy - discRadius, discRadius * 2, discRadius * 2);

        var ring = new RectangleF(cx - center, cy - center, center * 2, center * 2);
        using (var track = new Pen(theme.Track, width))
            g.DrawEllipse(track, ring);

        if (double.IsNaN(progress) || progress < 0) progress = 0;
        if (progress > 0) DrawArc(g, ring, width, theme.Arc, Math.Min(progress, 1));
        if (progress > 1) DrawArc(g, ring, width, Palette.ToColor(Palette.Overflow), Math.Min(progress - 1, 1));

        if (marker is { } m && !double.IsNaN(m))
        {
            // A white knob on the ring, a little wider than it, outlined in dark so it reads on the
            // white arc as well as on the grey track. Sized to stay inside the bounds.
            var angle = (Math.Clamp(m, 0, 1) * 360 - 90) * Math.PI / 180;
            var x = cx + (float)(Math.Cos(angle) * center);
            var y = cy + (float)(Math.Sin(angle) * center);
            var halo = Math.Max(1f, size * 0.012f);
            var dot = width / 2f + size * 0.015f - halo;
            using (var brush = new SolidBrush(Palette.ToColor(Palette.Halo)))
                g.FillEllipse(brush, x - dot - halo, y - dot - halo, (dot + halo) * 2, (dot + halo) * 2);
            using (var brush = new SolidBrush(Palette.ToColor(Palette.Marker)))
                g.FillEllipse(brush, x - dot, y - dot, dot * 2, dot * 2);
        }
    }

    static void DrawArc(Graphics g, RectangleF ring, float width, Color color, double fraction)
    {
        using var pen = new Pen(color, width);
        if (fraction >= 0.999)
        {
            g.DrawEllipse(pen, ring);
            return;
        }
        pen.StartCap = LineCap.Round;
        pen.EndCap = LineCap.Round;
        g.DrawArc(pen, ring, -90f, (float)Math.Max(fraction * 360, 1));
    }

    public static Bitmap RenderBitmap(int size, double progress, Color disc, RingTheme theme,
        double? marker = null, float thickness = TrayThickness, string? letter = null)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.Clear(Color.Transparent);
        Draw(g, new RectangleF(0, 0, size, size), progress, disc, theme, marker, thickness);
        if (!string.IsNullOrEmpty(letter)) DrawLetter(g, size, thickness, letter, InkFor(disc));
        return bmp;
    }

    /// <summary>Text color that reads on this disc: white on dark ones, near-black on light ones.</summary>
    public static Color InkFor(Color disc) =>
        Palette.ToColor(Palette.InkFor($"#{disc.R:X2}{disc.G:X2}{disc.B:X2}"));

    /// <summary>A letter in the disc, so two tray icons (Session / Hebdo) can be told apart.</summary>
    static void DrawLetter(Graphics g, int size, float thickness, string letter, Color ink)
    {
        var outer = size / 2f * 0.97f;
        var disc = outer - size * thickness - size * 0.05f;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
        using var font = new Font("Segoe UI", disc * 1.55f, FontStyle.Bold, GraphicsUnit.Pixel);
        using var format = new StringFormat(StringFormat.GenericTypographic)
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
        };
        using var brush = new SolidBrush(ink);
        g.DrawString(letter, font, brush, new RectangleF(0, size * 0.03f, size, size), format);
    }
}
