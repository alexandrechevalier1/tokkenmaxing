using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace TokkenMaxing;

/// <summary>What the dashboard needs from its owner (the tray app, or the preview stub).</summary>
interface IDashboardHost
{
    AppSettings Settings { get; }
    ApiServer? Server { get; }
    void SetTarget(string key, int target);
    void SetTrayIcon(string key, bool visible);
    void SetServerEnabled(bool value);
    void SetStartup(bool value);
    void RegenerateAccessCode();
    void AllowFirewall();
    Task RefreshNowAsync();
}

/// <summary>
/// TokkenMaxing.exe --preview &lt;dir&gt; : renders the dashboard and the tray icons to PNG files,
/// to check the visuals without touching the real taskbar. Uses Claude Code's cached numbers
/// (no network call).
/// </summary>
static class Preview
{
    sealed class StubHost(AppSettings settings) : IDashboardHost
    {
        public AppSettings Settings { get; } = settings;
        public ApiServer? Server => null;
        public void SetTarget(string key, int target) { }
        public void SetTrayIcon(string key, bool visible) { }
        public void SetServerEnabled(bool value) { }
        public void SetStartup(bool value) { }
        public void RegenerateAccessCode() { }
        public void AllowFirewall() { }
        public Task RefreshNowAsync() => Task.CompletedTask;
    }

    public static void Render(string dir)
    {
        Directory.CreateDirectory(dir);

        var client = new PlanUsageClient();
        client.LoadCache();
        var settings = AppSettings.Load();
        var report = UsageReportBuilder.Build(client, settings);

        using (var form = new PopupForm(new StubHost(settings)))
        {
            form.Location = new Point(-10000, -10000);
            form.ShowReport(report);
            form.Show();
            Application.DoEvents();
            using var bmp = new Bitmap(form.Width, form.Height);
            form.DrawToBitmap(bmp, new Rectangle(Point.Empty, form.Size));
            bmp.Save(Path.Combine(dir, "dashboard.png"), ImageFormat.Png);
            form.Close();
        }

        // Large rings across the whole scale: usage vs. the white dot, 0 % to 200 % of the objective.
        {
            const int ring = 148, pad = 12;
            (double percent, double expected)[] rings =
                [(0, 40), (10, 40), (20, 40), (30, 40), (40, 40), (50, 40), (60, 40), (70, 40), (80, 40), (95, 95), (100, 30)];
            using var sheet = new Bitmap(rings.Length * (ring + pad) + pad, ring + 2 * pad);
            using var g = Graphics.FromImage(sheet);
            g.Clear(Palette.ToColor("#0B1220"));
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using var font = new Font("Segoe UI Semibold", ring * 0.17f, GraphicsUnit.Pixel);
            using var center = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            for (var i = 0; i < rings.Length; i++)
            {
                var (percent, expected) = rings[i];
                var color = Palette.ToColor(Palette.ColorForRatio(percent / expected));
                var rect = new RectangleF(pad + i * (ring + pad), pad, ring, ring);
                RingRenderer.Draw(g, rect, percent / 100, color, RingTheme.App, expected / 100, 0.09f);
                using var ink = new SolidBrush(RingRenderer.InkFor(color));
                g.DrawString($"{percent:0} %", font, ink, new PointF(rect.X + ring / 2f, rect.Y + ring / 2f), center);
            }
            sheet.Save(Path.Combine(dir, "rings.png"), ImageFormat.Png);
        }

        // Tray icons: 5 paces x S/H letters x 3 sizes, on a dark and a light taskbar, zoomed x4.
        (double percent, double ratio, string letter)[] states = [(10, 0, "S"), (35, 0.5, "H"), (60, 1, "S"), (85, 1.5, "H"), (100, 2, "S")];
        int[] sizes = [16, 24, 32];
        const int zoom = 4, cell = 40;
        foreach (var (name, bg, theme) in new[]
                 {
                     ("tray-dark.png", Palette.ToColor("#1C1C1C"), RingTheme.TrayDark),
                     ("tray-light.png", Palette.ToColor("#EEEEEE"), RingTheme.TrayLight),
                 })
        {
            using var sheet = new Bitmap(states.Length * cell * zoom, sizes.Length * cell * zoom);
            using var g = Graphics.FromImage(sheet);
            g.Clear(bg);
            g.InterpolationMode = InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            for (var row = 0; row < sizes.Length; row++)
            for (var col = 0; col < states.Length; col++)
            {
                var (percent, ratio, letter) = states[col];
                var color = Palette.ToColor(Palette.ColorForRatio(ratio));
                using var icon = RingRenderer.RenderBitmap(sizes[row], percent / 100, color, theme, letter: letter);
                var x = col * cell * zoom + (cell - sizes[row]) * zoom / 2;
                var y = row * cell * zoom + (cell - sizes[row]) * zoom / 2;
                g.DrawImage(icon, new Rectangle(x, y, sizes[row] * zoom, sizes[row] * zoom));
            }
            sheet.Save(Path.Combine(dir, name), ImageFormat.Png);
        }
    }
}
