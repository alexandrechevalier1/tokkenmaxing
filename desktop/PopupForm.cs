using System.Drawing.Text;
using System.Runtime.InteropServices;

namespace TokkenMaxing;

/// <summary>Dashboard shown when a tray ring is clicked: Session and Hebdo side by side.</summary>
sealed class PopupForm : Form
{
    static readonly Color Bg = Palette.ToColor("#0B1220");
    static readonly Color Surface = Palette.ToColor("#1E293B");
    static readonly Color Border = Palette.ToColor("#334155");
    static readonly Color Fg = Palette.ToColor("#F8FAFC");
    static readonly Color Muted = Palette.ToColor("#94A3B8");
    static readonly Color Danger = Palette.ToColor("#F87171");

    const int W = 360;
    const int Pad = 16;
    const int Col = (W - 2 * Pad) / 2;
    const int RingSize = 148;
    const int MaxRows = 4;

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    readonly IDashboardHost _host;
    readonly Label _source, _address, _code, _hint;
    readonly RingView[] _rings = new RingView[2];
    readonly Label[] _resets = new Label[2];
    readonly Label[] _statuses = new Label[2];
    readonly Label[] _expected = new Label[2];
    readonly Label[] _rowNames = new Label[MaxRows];
    readonly Label[] _rowValues = new Label[MaxRows];
    readonly NumericUpDown[] _targets = new NumericUpDown[2];
    readonly CheckBox _startup, _share;
    readonly Button _copy, _newCode, _refresh;
    readonly LinkLabel _firewall;
    readonly ToolTip _tooltip = new();
    bool _syncing;

    public event EventHandler? AutoHidden;

    public PopupForm(IDashboardHost host)
    {
        _host = host;

        SuspendLayout();
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        BackColor = Bg;
        ForeColor = Fg;
        Font = new Font("Segoe UI", 9F);
        KeyPreview = true;
        Text = "TokkenMaxing";

        var y = 12;
        Add(new Label { Text = "TokkenMaxing", Font = new Font("Segoe UI Semibold", 11.5F), AutoSize = true, Location = new(Pad, y) });
        _refresh = Add(FlatButton("Actualiser", new(W - Pad - 84, y), 84));
        _refresh.Click += async (_, _) =>
        {
            _refresh.Enabled = false;
            await _host.RefreshNowAsync();
            _refresh.Enabled = true;
        };
        y += 30;
        _source = Add(new Label { ForeColor = Muted, AutoSize = false, Location = new(Pad, y), Size = new(W - 2 * Pad, 20), Font = new Font("Segoe UI", 8.5F) });

        // The two rings
        y += 28;
        string[] names = ["Session (5 h)", "Hebdo"];
        for (var i = 0; i < 2; i++)
        {
            var left = Pad + i * Col;
            _rings[i] = Add(new RingView { Location = new(left + (Col - RingSize) / 2, y), Size = new(RingSize, RingSize), BackColor = Bg });
            _tooltip.SetToolTip(_rings[i], names[i]);
            _resets[i] = Add(new Label
            {
                ForeColor = Muted, AutoSize = false, TextAlign = ContentAlignment.MiddleCenter,
                Location = new(left, y + RingSize + 6), Size = new(Col, 18), Font = new Font("Segoe UI", 8.5F),
            });
            _statuses[i] = Add(new Label
            {
                AutoSize = false, TextAlign = ContentAlignment.TopCenter,
                Location = new(left + 4, y + RingSize + 26), Size = new(Col - 8, 34), Font = new Font("Segoe UI", 8.5F),
            });
            _expected[i] = Add(new Label
            {
                ForeColor = Muted, AutoSize = false, TextAlign = ContentAlignment.MiddleCenter,
                Location = new(left, y + RingSize + 60), Size = new(Col, 18), Font = new Font("Segoe UI", 8.5F),
            });
            _tooltip.SetToolTip(_expected[i], "Le point blanc : objectif × temps écoulé dans la fenêtre");
        }
        y += RingSize + 84;
        Separator(ref y);

        // Where the week went (Cowork, Claude Code, chats…)
        Add(new Label { Text = "Répartition de la semaine (en % du quota)", ForeColor = Muted, AutoSize = true, Location = new(Pad, y), Font = new Font("Segoe UI", 8.5F) });
        y += 22;
        for (var i = 0; i < MaxRows; i++)
        {
            _rowNames[i] = Add(new Label { AutoSize = false, Location = new(Pad, y + i * 19), Size = new(200, 19), TextAlign = ContentAlignment.MiddleLeft });
            _rowValues[i] = Add(new Label
            {
                AutoSize = false, Location = new(W - Pad - 100, y + i * 19), Size = new(100, 19),
                TextAlign = ContentAlignment.MiddleRight, Font = new Font("Segoe UI Semibold", 9F),
            });
        }
        y += MaxRows * 19 + 8;
        Separator(ref y);

        // Objectives: % of the limit to have used at reset, paced over the window (white dot, disc color)
        Add(new Label
        {
            Text = "Objectifs : % de la limite à utiliser d'ici la réinitialisation", ForeColor = Muted, AutoSize = false,
            Location = new(Pad, y), Size = new(W - 2 * Pad, 18), Font = new Font("Segoe UI", 8.5F),
        });
        y += 22;
        string[] targetNames = ["Objectif session", "Objectif hebdo"];
        string[] keys = ["session", "weekly"];
        for (var i = 0; i < 2; i++)
        {
            var key = keys[i];
            Add(new Label { Text = targetNames[i], AutoSize = false, Location = new(Pad, y), Size = new(180, 26), TextAlign = ContentAlignment.MiddleLeft });
            var nud = Add(new NumericUpDown
            {
                Location = new(W - Pad - 100, y + 1), Size = new(72, 24), Minimum = 1, Maximum = 100, Increment = 5,
                BackColor = Surface, ForeColor = Fg, BorderStyle = BorderStyle.FixedSingle, TextAlign = HorizontalAlignment.Right,
            });
            nud.ValueChanged += (_, _) =>
            {
                if (!_syncing) _host.SetTarget(key, (int)nud.Value);
            };
            _targets[i] = nud;
            Add(new Label { Text = "%", ForeColor = Muted, AutoSize = false, Location = new(W - Pad - 24, y), Size = new(24, 26), TextAlign = ContentAlignment.MiddleRight });
            y += 30;
        }
        Add(new Label
        {
            Text = "Le point blanc marque où tu devrais en être maintenant. La couleur du disque compare ta conso à ce point :",
            ForeColor = Muted, AutoSize = false, Location = new(Pad, y), Size = new(W - 2 * Pad, 30), Font = new Font("Segoe UI", 8F),
        });
        y += 32;
        Add(new ScaleView { Location = new(Pad, y), Size = new(W - 2 * Pad, 30), BackColor = Bg, ForeColor = Muted });
        y += 38;
        _startup = Add(Check("Lancer au démarrage de Windows", y));
        _startup.CheckedChanged += (_, _) => { if (!_syncing) _host.SetStartup(_startup.Checked); };
        y += 30;
        Separator(ref y);

        // Phone
        _share = Add(Check("Partager avec le téléphone (réseau local)", y));
        _share.CheckedChanged += (_, _) => { if (!_syncing) _host.SetServerEnabled(_share.Checked); };
        y += 28;
        _address = Add(new Label { AutoSize = false, Location = new(Pad, y), Size = new(W - 2 * Pad, 20), Font = new Font("Consolas", 9.5F) });
        y += 24;
        _code = Add(new Label { AutoSize = false, Location = new(Pad, y), Size = new(170, 26), TextAlign = ContentAlignment.MiddleLeft, Font = new Font("Consolas", 11F, FontStyle.Bold) });
        _copy = Add(FlatButton("Copier", new(W - Pad - 152, y), 70));
        _copy.Click += (_, _) => CopyAddress();
        _newCode = Add(FlatButton("Nouveau", new(W - Pad - 78, y), 78));
        _tooltip.SetToolTip(_newCode, "Générer un nouveau code (le téléphone devra être reconfiguré)");
        _newCode.Click += (_, _) => _host.RegenerateAccessCode();
        y += 34;
        _hint = Add(new Label { ForeColor = Muted, AutoSize = false, Location = new(Pad, y), Size = new(W - 2 * Pad, 34), Font = new Font("Segoe UI", 8F) });
        y += 36;
        _firewall = Add(new LinkLabel
        {
            Text = "Téléphone bloqué ? Autoriser dans le pare-feu…", AutoSize = true, Location = new(Pad, y),
            Font = new Font("Segoe UI", 8F), LinkColor = Palette.ToColor(Palette.Accent), ActiveLinkColor = Fg,
            LinkBehavior = LinkBehavior.HoverUnderline,
        });
        _tooltip.SetToolTip(_firewall, "Autorise le port du serveur depuis les réseaux privés et depuis tes appareils Tailscale uniquement (demande administrateur).");
        _firewall.LinkClicked += (_, _) => _host.AllowFirewall();
        y += 28;

        ClientSize = new Size(W, y);
        ResumeLayout(false);
        PerformLayout();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            const int CS_DROPSHADOW = 0x20000;
            var cp = base.CreateParams;
            cp.ClassStyle |= CS_DROPSHADOW;
            return cp;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            var round = 2; // DWMWCP_ROUND
            DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
            var dark = 1; // DWMWA_USE_IMMERSIVE_DARK_MODE
            DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
        }
        catch
        {
            // Older Windows: square corners, that's fine.
        }
    }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        if (!Visible) return;
        Hide();
        AutoHidden?.Invoke(this, EventArgs.Empty);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.KeyCode == Keys.Escape) Hide();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(Border);
        e.Graphics.DrawRectangle(pen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
    }

    public void ShowNearTray(UsageReport? report)
    {
        if (report is not null) ShowReport(report);
        if (!IsHandleCreated) CreateHandle();
        Place();
        Show();
        Place(); // size can change once the form is scaled for the monitor DPI
        Activate();
    }

    void Place()
    {
        var screen = Screen.FromPoint(Cursor.Position);
        var area = screen.WorkingArea;
        var bounds = screen.Bounds;
        var margin = (int)(12 * DeviceDpi / 96f);
        var x = area.Right - Width - margin;
        var y = area.Bottom - Height - margin;
        if (area.Top > bounds.Top) y = area.Top + margin;    // taskbar on top
        if (area.Left > bounds.Left) x = area.Left + margin; // taskbar on the left
        Location = new Point(Math.Max(area.Left, x), Math.Max(area.Top, y));
    }

    public void ShowReport(UsageReport report)
    {
        _syncing = true;
        try
        {
            // Where the numbers come from, and how fresh they are.
            if (!report.HasData)
            {
                _source.Text = report.Problem ?? "Lecture en cours…";
                _source.ForeColor = report.Problem is null ? Muted : Danger;
            }
            else
            {
                var origin = report.Source == "live" ? "Claude, en direct" : "cache de Claude Code";
                _source.Text = report.Problem is { } problem
                    ? $"⚠ {problem} · {origin} {Fmt.Ago(report.FetchedAt)}"
                    : $"Source : {origin} · à jour {Fmt.Ago(report.FetchedAt)}";
                _source.ForeColor = report.Problem is null ? Muted : Danger;
            }

            for (var i = 0; i < 2; i++)
            {
                var u = report.Limits[i];
                _rings[i].Set(report.HasData ? u.Progress : 0, Palette.ToColor(u.Color), u.Marker,
                    report.HasData ? Fmt.Percent(u.Percent) : "…", u.Label);
                _resets[i].Text = report.HasData ? Fmt.ResetShort(u) : "";
                _tooltip.SetToolTip(_resets[i], report.HasData ? Fmt.ResetLine(u) : "");
                _statuses[i].Text = !report.HasData ? ""
                    : u.Ratio is null ? (u.Key == "session" ? "" : u.StatusLabel) // the reset line already says "no session"
                    : $"{u.StatusLabel}\n{Fmt.Ratio(u)}";
                _statuses[i].ForeColor = u.Ratio is null ? Muted : Lighten(Palette.ToColor(u.Color));
                _expected[i].Text = Fmt.Expected(u);
                if (!_targets[i].ContainsFocus) _targets[i].Value = Math.Clamp(u.Target, 1, 100);
            }

            var rows = report.Breakdown.OrderByDescending(r => r.PercentOfLimit).Take(MaxRows).ToList();
            for (var i = 0; i < MaxRows; i++)
            {
                var row = i < rows.Count ? rows[i] : null;
                _rowNames[i].Text = row?.Label ?? "";
                _rowValues[i].Text = row is null ? "" : Fmt.Percent(row.PercentOfLimit);
                _rowNames[i].ForeColor = _rowValues[i].ForeColor = row is { PercentOfLimit: > 0 } ? Fg : Muted;
            }
            if (rows.Count == 0) _rowNames[0].Text = report.HasData ? "Pas de détail fourni par Claude" : "";

            _startup.Checked = StartupManager.IsEnabled;
            ShowServer();
        }
        finally
        {
            _syncing = false;
        }
    }

    void ShowServer()
    {
        var settings = _host.Settings;
        var server = _host.Server;
        _share.Checked = settings.ServerEnabled;
        _copy.Enabled = _newCode.Enabled = settings.ServerEnabled;
        _firewall.Visible = settings.ServerEnabled;

        if (!settings.ServerEnabled)
        {
            _address.Text = "—";
            _code.Text = "";
            _hint.Text = "Active le partage pour voir tes anneaux sur le téléphone.";
            _hint.ForeColor = Muted;
            return;
        }

        var (url, viaTailscale) = PhoneAddress();
        var lan = ApiServer.LanAddresses().Select(ip => $"http://{ip}:{settings.Port}").ToList();
        _address.Text = url is null ? $"Pas de réseau · port {settings.Port}" : viaTailscale ? $"{url}  · Tailscale" : url;
        var others = viaTailscale ? lan : lan.Skip(1).ToList();
        _tooltip.SetToolTip(_address, others.Count > 0
            ? (viaTailscale ? "Sur le Wi-Fi du PC seulement :\n" : "Autres adresses :\n") + string.Join("\n", others)
            : "");
        _code.Text = $"Code : {settings.AccessCode}";
        _hint.Text = server?.Error is { } error
            ? $"Serveur arrêté : {error}"
            : viaTailscale
                ? "Entre l'adresse et le code dans l'appli du téléphone : elle marche partout (4G, autre Wi-Fi) tant que Tailscale y est actif."
                : "Entre l'adresse et le code dans l'appli TokkenMaxing du téléphone (même Wi-Fi que le PC, ou installe Tailscale).";
        _hint.ForeColor = server?.Error is null ? Muted : Danger;
    }

    /// <summary>The address to give the phone: Tailscale (works from anywhere) first, else the LAN one.</summary>
    (string? url, bool viaTailscale) PhoneAddress()
    {
        var port = _host.Settings.Port;
        if (ApiServer.TailscaleAddress() is { } ts) return ($"http://{ts}:{port}", true);
        var ips = ApiServer.LanAddresses();
        return ips.Count > 0 ? ($"http://{ips[0]}:{port}", false) : (null, false);
    }

    void CopyAddress()
    {
        if (PhoneAddress().url is not { } url) return;
        try
        {
            Clipboard.SetText(url);
            _copy.Text = "Copié ✓";
            var reset = new System.Windows.Forms.Timer { Interval = 1500 };
            reset.Tick += (_, _) => { _copy.Text = "Copier"; reset.Dispose(); };
            reset.Start();
        }
        catch (ExternalException)
        {
            // Clipboard busy.
        }
    }

    static Color Lighten(Color c) => Color.FromArgb(
        c.R + (255 - c.R) * 2 / 5, c.G + (255 - c.G) * 2 / 5, c.B + (255 - c.B) * 2 / 5);

    T Add<T>(T control) where T : Control
    {
        Controls.Add(control);
        return control;
    }

    static CheckBox Check(string text, int y)
    {
        var box = new CheckBox
        {
            Text = text, AutoSize = true, Location = new(Pad, y), ForeColor = Fg, BackColor = Bg,
            FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
        };
        box.FlatAppearance.BorderColor = Palette.ToColor("#64748B");
        box.FlatAppearance.CheckedBackColor = Surface;
        return box;
    }

    static Button FlatButton(string text, Point location, int width)
    {
        var button = new Button
        {
            Text = text, Location = location, Size = new(width, 26), FlatStyle = FlatStyle.Flat,
            BackColor = Surface, ForeColor = Fg, Cursor = Cursors.Hand, Font = new Font("Segoe UI", 8.5F),
        };
        button.FlatAppearance.BorderColor = Border;
        button.FlatAppearance.MouseOverBackColor = Border;
        return button;
    }

    void Separator(ref int y)
    {
        Add(new Panel { BackColor = Surface, Location = new(Pad, y), Size = new(W - 2 * Pad, 1) });
        y += 12;
    }
}

/// <summary>A big ring with the percentage and the ring's name inside the disc.</summary>
sealed class RingView : Control
{
    double _progress;
    Color _disc = Palette.ToColor(Palette.Idle);
    double? _marker;
    string _big = "…";
    string _small = "";

    public RingView()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                 | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
    }

    public void Set(double progress, Color disc, double? marker, string big, string small)
    {
        _progress = progress;
        _disc = disc;
        _marker = marker;
        _big = big;
        _small = small;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(BackColor);
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

        var size = Math.Min(Width, Height);
        var rect = new RectangleF((Width - size) / 2f, (Height - size) / 2f, size, size);
        RingRenderer.Draw(g, rect, _progress, _disc, RingTheme.App, _marker, 0.09f);

        var ink = RingRenderer.InkFor(_disc);
        using var big = new Font("Segoe UI Semibold", size * 0.17f, GraphicsUnit.Pixel);
        using var small = new Font("Segoe UI", size * 0.08f, GraphicsUnit.Pixel);
        using var strong = new SolidBrush(ink);
        using var soft = new SolidBrush(Color.FromArgb(225, ink));
        using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
        var cx = rect.X + rect.Width / 2;
        var cy = rect.Y + rect.Height / 2;
        g.DrawString(_big, big, strong, new PointF(cx, cy - size * 0.04f), format);
        g.DrawString(_small, small, soft, new PointF(cx, cy + size * 0.13f), format);
    }
}

/// <summary>Legend of the disc colors: the scale from 0 % to 200 % of the objective.</summary>
sealed class ScaleView : Control
{
    public ScaleView()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                 | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(BackColor);
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

        var barHeight = 8f * DeviceDpi / 96f;
        var bar = new RectangleF(0, 1, Width - 1, barHeight);
        using (var brush = new System.Drawing.Drawing2D.LinearGradientBrush(bar, Color.Black, Color.Black, 0f))
        {
            brush.InterpolationColors = new System.Drawing.Drawing2D.ColorBlend
            {
                Colors = Palette.Scale.Select(Palette.ToColor).ToArray(),
                Positions = Enumerable.Range(0, Palette.Scale.Length).Select(i => i / (float)(Palette.Scale.Length - 1)).ToArray(),
            };
            using var path = new System.Drawing.Drawing2D.GraphicsPath();
            var d = barHeight;
            path.AddArc(bar.X, bar.Y, d, d, 90, 180);
            path.AddArc(bar.Right - d, bar.Y, d, d, 270, 180);
            path.CloseFigure();
            g.FillPath(brush, path);
        }

        using var font = new Font("Segoe UI", 8F);
        using var text = new SolidBrush(ForeColor);
        var y = bar.Bottom + 3;
        var h = Height - y;
        using var left = new StringFormat { Alignment = StringAlignment.Near };
        using var middle = new StringFormat { Alignment = StringAlignment.Center };
        using var right = new StringFormat { Alignment = StringAlignment.Far };
        g.DrawString("0 % · trop lent", font, text, new RectangleF(0, y, Width, h), left);
        g.DrawString("100 %", font, text, new RectangleF(0, y, Width, h), middle);
        g.DrawString("200 % · trop vite", font, text, new RectangleF(0, y, Width, h), right);
    }
}
