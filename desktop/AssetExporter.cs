using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

namespace TokkenMaxing;

/// <summary>Renders the app icons (Windows .ico, Android/Expo PNGs) with the same ring code as the tray.</summary>
static class AssetExporter
{
    static readonly Color Night = Palette.ToColor("#0B1220");
    static readonly Color Green = Palette.ToColor(Palette.ColorForRatio(1)); // on pace
    const double SampleProgress = 0.72;

    public static void Export(string assetsDir, string icoPath)
    {
        Directory.CreateDirectory(assetsDir);

        Save(Path.Combine(assetsDir, "icon.png"), 1024, g =>
        {
            g.Clear(Night);
            Ring(g, 1024, 0.74f);
        });
        Save(Path.Combine(assetsDir, "android-icon-background.png"), 1024, g => g.Clear(Night));
        Save(Path.Combine(assetsDir, "android-icon-foreground.png"), 1024, g => Ring(g, 1024, 0.56f));
        Save(Path.Combine(assetsDir, "android-icon-monochrome.png"), 1024, g =>
        {
            var mono = new RingTheme(Color.FromArgb(90, Color.White), Color.White);
            var s = 1024 * 0.56f;
            RingRenderer.Draw(g, new RectangleF((1024 - s) / 2, (1024 - s) / 2, s, s), SampleProgress,
                Color.FromArgb(200, Color.White), mono, null, 0.12f);
        });
        Save(Path.Combine(assetsDir, "splash-icon.png"), 1024, g => Ring(g, 1024, 1f));
        Save(Path.Combine(assetsDir, "favicon.png"), 48, g => Ring(g, 48, 1f, RingRenderer.TrayThickness));
        Save(Path.Combine(assetsDir, "widget-preview.png"), 440, WidgetPreview);

        WriteIco(icoPath, [16, 20, 24, 32, 40, 48, 64, 128, 256]);
    }

    static void Ring(Graphics g, int canvas, float scale, float thickness = 0.12f)
    {
        var s = canvas * scale;
        RingRenderer.Draw(g, new RectangleF((canvas - s) / 2, (canvas - s) / 2, s, s), SampleProgress, Green,
            RingTheme.App, null, thickness);
    }

    static void WidgetPreview(Graphics g)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        using (var card = RoundedRect(new RectangleF(8, 8, 424, 424), 56))
        using (var brush = new SolidBrush(Night))
            g.FillPath(brush, card);

        using var center = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        using var big = new Font("Segoe UI Semibold", 40, GraphicsUnit.Pixel);
        using var mid = new Font("Segoe UI Semibold", 26, GraphicsUnit.Pixel);
        using var small = new Font("Segoe UI", 20, GraphicsUnit.Pixel);
        using var muted = new SolidBrush(Palette.ToColor("#94A3B8"));
        (string label, double percent, double expected, string reset)[] rings =
        [
            ("Session", 62, 70, "22:30"),
            ("Hebdo", 45, 43, "sam. 08:00"),
        ];
        for (var i = 0; i < rings.Length; i++)
        {
            var (label, percent, expected, reset) = rings[i];
            var cx = 120 + i * 200;
            var ring = new RectangleF(cx - 92, 96, 184, 184);
            var color = Palette.ToColor(Palette.ColorForRatio(percent / expected));
            RingRenderer.Draw(g, ring, percent / 100, color, RingTheme.App, expected / 100, 0.1f);
            using var ink = new SolidBrush(RingRenderer.InkFor(color));
            g.DrawString($"{percent:0}%", big, ink, new PointF(cx, 188), center);
            g.DrawString(label, mid, Brushes.White, new PointF(cx, 312), center);
            g.DrawString(reset, small, muted, new PointF(cx, 344), center);
        }
    }

    static GraphicsPath RoundedRect(RectangleF r, float radius)
    {
        var d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    static void Save(string path, int size, Action<Graphics> draw)
    {
        using var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Transparent);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            draw(g);
        }
        bmp.Save(path, ImageFormat.Png);
    }

    /// <summary>Multi-size .ico with PNG-compressed frames: the ring on a dark plate so it reads on any background.</summary>
    static void WriteIco(string path, int[] sizes)
    {
        var frames = sizes.Select(size =>
        {
            using var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using var plate = new SolidBrush(Night);
                g.FillEllipse(plate, 0, 0, size, size);
                var inner = size * 0.86f;
                RingRenderer.Draw(g, new RectangleF((size - inner) / 2, (size - inner) / 2, inner, inner), SampleProgress,
                    Green, RingTheme.App, null, size <= 32 ? RingRenderer.TrayThickness : 0.12f);
            }
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            return (size, data: ms.ToArray());
        }).ToList();

        using var fs = File.Create(path);
        using var w = new BinaryWriter(fs);
        w.Write((ushort)0);
        w.Write((ushort)1);
        w.Write((ushort)frames.Count);
        var offset = 6 + 16 * frames.Count;
        foreach (var (size, data) in frames)
        {
            w.Write((byte)(size >= 256 ? 0 : size));
            w.Write((byte)(size >= 256 ? 0 : size));
            w.Write((byte)0);
            w.Write((byte)0);
            w.Write((ushort)1);
            w.Write((ushort)32);
            w.Write(data.Length);
            w.Write(offset);
            offset += data.Length;
        }
        foreach (var (_, data) in frames) w.Write(data);
    }
}
