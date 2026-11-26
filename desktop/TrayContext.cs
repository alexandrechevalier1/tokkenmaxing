using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace TokkenMaxing;

/// <summary>Owns the two tray rings (Session, Hebdo), the refresh loop and the dashboard.</summary>
sealed class TrayContext : ApplicationContext, IDashboardHost
{
    readonly AppSettings _settings = AppSettings.Load();
    readonly PlanUsageClient _client = new();
    readonly ContextMenuStrip _menu;
    readonly TrayRing _sessionIcon;
    readonly TrayRing _weeklyIcon;
    readonly System.Windows.Forms.Timer _timer;
    readonly ToolStripMenuItem _sessionItem, _weeklyItem, _startupItem;

    UsageReport? _report;
    PopupForm? _popup;
    bool _busy;
    DateTime _popupHiddenAt;

    public TrayContext()
    {
        _sessionItem = new ToolStripMenuItem("Anneau Session dans la barre des tâches", null, (_, _) => SetTrayIcon("session", !_settings.TraySession));
        _weeklyItem = new ToolStripMenuItem("Anneau Hebdo dans la barre des tâches", null, (_, _) => SetTrayIcon("weekly", !_settings.TrayWeekly));
        _startupItem = new ToolStripMenuItem("Lancer au démarrage de Windows", null, (_, _) => SetStartup(!StartupManager.IsEnabled));

        _menu = new ContextMenuStrip();
        _menu.Items.Add(new ToolStripMenuItem("Ouvrir le tableau de bord", null, (_, _) => ShowPopup())
        {
            Font = new Font(_menu.Font, FontStyle.Bold),
        });
        _menu.Items.Add(new ToolStripMenuItem("Actualiser maintenant", null, async (_, _) => await RefreshNowAsync()));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(_sessionItem);
        _menu.Items.Add(_weeklyItem);
        _menu.Items.Add(_startupItem);
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Ouvrir le dossier des réglages", null, (_, _) =>
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{AppSettings.Dir}\"") { UseShellExecute = true })));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add(new ToolStripMenuItem("Quitter", null, (_, _) => ExitThread()));
        _menu.Opening += (_, _) => SyncMenu();

        // Weekly first: Windows usually lists the most recently added icon closest to the clock.
        _weeklyIcon = new TrayRing("H", _menu, TogglePopup);
        _sessionIcon = new TrayRing("S", _menu, TogglePopup);
        _weeklyIcon.Visible = _settings.TrayWeekly;
        _sessionIcon.Visible = _settings.TraySession;

        SystemEvents.UserPreferenceChanged += OnThemeChanged;
        SystemEvents.DisplaySettingsChanged += OnThemeChanged;
        SchedulePromotion();

        _timer = new System.Windows.Forms.Timer { Interval = 50 };
        _timer.Tick += async (_, _) =>
        {
            _timer.Interval = 15_000; // countdowns and Claude Code's cache every 15 s, Claude itself every RefreshSeconds
            await TickAsync(force: false);
        };
        _timer.Start();
    }

    async Task TickAsync(bool force)
    {
        if (_busy) return;
        _busy = true;
        try
        {
            var due = force || _client.LastAttempt is null
                      || DateTimeOffset.Now - _client.LastAttempt.Value >= TimeSpan.FromSeconds(_settings.RefreshSeconds);
            if (due) await _client.RefreshAsync();
            else _client.LoadCache();
            Rebuild();
        }
        finally
        {
            _busy = false;
        }
    }

    public Task RefreshNowAsync() => TickAsync(force: true);

    /// <summary>Recomputes the report (cheap) and pushes it to the icons and the dashboard.</summary>
    void Rebuild()
    {
        _settings.RememberWeeklyReset(_client.Latest?.Weekly?.ResetsAt);
        var report = UsageReportBuilder.Build(_client, _settings);
        _report = report;

        foreach (var (icon, u, name) in new[] { (_sessionIcon, report.Session, "Session (5 h)"), (_weeklyIcon, report.Weekly, "Hebdo") })
        {
            var pace = u.Expected is { } e
                ? $"Attendu {Fmt.Whole(e)} % · {Fmt.Ratio(u)}"
                : u.StatusLabel;
            var status = report.Problem is { } problem ? "⚠ " + problem : $"À jour {Fmt.Ago(report.FetchedAt)}";
            var tip = report.HasData
                ? $"Claude · {name} : {Fmt.Percent(u.Percent)}\n{pace}\n{Fmt.ResetLine(u)}\n{status}"
                : $"Claude · {name}\n{report.Problem ?? "Lecture en cours…"}";
            icon.Update(report.HasData ? u.Progress : 0, Palette.ToColor(u.Color), tip);
        }

        if (_popup is { Visible: true }) _popup.ShowReport(report);
    }

    void SyncMenu()
    {
        _sessionItem.Checked = _settings.TraySession;
        _weeklyItem.Checked = _settings.TrayWeekly;
        _startupItem.Checked = StartupManager.IsEnabled;
    }

    // ---- settings, used by the menu and the dashboard ----

    public void SetTarget(string key, int target)
    {
        target = Math.Clamp(target, 1, 100);
        if (_settings.TargetFor(key) == target) return;
        if (key == "weekly") _settings.WeeklyTarget = target;
        else _settings.SessionTarget = target;
        _settings.Save();
        Rebuild();
    }

    public void SetTrayIcon(string key, bool visible)
    {
        if (key == "weekly") _settings.TrayWeekly = visible;
        else _settings.TraySession = visible;
        if (!_settings.TraySession && !_settings.TrayWeekly)
        {
            // Keep at least one ring, or the app becomes unreachable.
            if (key == "weekly") _settings.TraySession = true;
            else _settings.TrayWeekly = true;
        }
        _settings.Save();
        _sessionIcon.Visible = _settings.TraySession;
        _weeklyIcon.Visible = _settings.TrayWeekly;
        SchedulePromotion();
        if (_popup is { Visible: true } && _report is { } r) _popup.ShowReport(r);
    }

    public void SetStartup(bool value)
    {
        StartupManager.Set(value);
        if (_popup is { Visible: true } && _report is { } r) _popup.ShowReport(r);
    }

    /// <summary>
    /// Windows 11 hides new tray icons behind the "^" overflow. Explorer registers an icon a moment
    /// after it first appears; then show it on the taskbar itself, unless the user already chose.
    /// </summary>
    static void SchedulePromotion()
    {
        var timer = new System.Windows.Forms.Timer { Interval = 4000 };
        timer.Tick += (_, _) =>
        {
            timer.Dispose();
            TrayPromotion.PromoteIfUndecided();
        };
        timer.Start();
    }

    // ---- dashboard ----

    void TogglePopup()
    {
        if (_popup is { Visible: true })
        {
            _popup.Hide();
            return;
        }
        // The click that deactivated (and so hid) the popup must not reopen it.
        if ((DateTime.UtcNow - _popupHiddenAt).TotalMilliseconds < 300) return;
        ShowPopup();
    }

    void ShowPopup()
    {
        if (_popup is null || _popup.IsDisposed)
        {
            _popup = new PopupForm(this);
            _popup.AutoHidden += (_, _) => _popupHiddenAt = DateTime.UtcNow;
        }
        _popup.ShowNearTray(_report);
        if (_client.LastAttempt is null || DateTimeOffset.Now - _client.LastAttempt.Value > TimeSpan.FromSeconds(60))
            _ = RefreshNowAsync();
    }

    void OnThemeChanged(object? sender, EventArgs e)
    {
        // Light/dark taskbar or DPI change: redraw both rings.
        _sessionIcon.Invalidate();
        _weeklyIcon.Invalidate();
        if (_report is not null) Rebuild();
    }

    protected override void ExitThreadCore()
    {
        SystemEvents.UserPreferenceChanged -= OnThemeChanged;
        SystemEvents.DisplaySettingsChanged -= OnThemeChanged;
        _timer.Stop();
        _popup?.Dispose();
        _sessionIcon.Dispose();
        _weeklyIcon.Dispose();
        base.ExitThreadCore();
    }
}

/// <summary>One ring in the notification area.</summary>
sealed class TrayRing : IDisposable
{
    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);

    readonly NotifyIcon _icon;
    readonly string _letter;
    IntPtr _handle;
    string _key = "";
    double _progress;
    Color _color = Palette.ToColor(Palette.Idle);

    public TrayRing(string letter, ContextMenuStrip menu, Action onLeftClick)
    {
        _letter = letter;
        _icon = new NotifyIcon { ContextMenuStrip = menu, Text = "TokkenMaxing" };
        _icon.MouseUp += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) onLeftClick();
        };
        Draw();
    }

    public bool Visible
    {
        get => _icon.Visible;
        set => _icon.Visible = value;
    }

    public void Update(double progress, Color color, string tooltip)
    {
        _progress = progress;
        _color = color;
        Draw();
        _icon.Text = tooltip.Length <= 127 ? tooltip : tooltip[..126] + "…";
    }

    public void Invalidate() => _key = "";

    void Draw()
    {
        var size = SystemInformation.SmallIconSize.Width;
        var theme = RingTheme.ForTaskbar();
        var key = $"{size}|{Math.Round(Math.Min(_progress, 2) * 200)}|{_color.ToArgb()}|{theme.Arc.ToArgb()}";
        if (key == _key) return;
        _key = key;

        using var bitmap = RingRenderer.RenderBitmap(size, _progress, _color, theme, letter: _letter);
        var handle = bitmap.GetHicon();
        var previous = _icon.Icon;
        var previousHandle = _handle;
        _icon.Icon = Icon.FromHandle(handle);
        _handle = handle;
        previous?.Dispose();
        if (previousHandle != IntPtr.Zero) DestroyIcon(previousHandle);
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        if (_handle != IntPtr.Zero) DestroyIcon(_handle);
    }
}

static class TrayPromotion
{
    /// <summary>
    /// Sets IsPromoted=1 on this exe's entries in HKCU\Control Panel\NotifyIconSettings (Windows 11) when the
    /// value is absent, i.e. the user never picked "show" or "hide" in Settings › Taskbar › Other system tray icons.
    /// </summary>
    public static void PromoteIfUndecided()
    {
        try
        {
            using var root = Registry.CurrentUser.OpenSubKey(@"Control Panel\NotifyIconSettings");
            if (root is null) return; // Windows 10: nothing to do
            var exe = Environment.ProcessPath ?? "";
            foreach (var name in root.GetSubKeyNames())
            {
                using var key = root.OpenSubKey(name, writable: true);
                if (key?.GetValue("ExecutablePath") is not string path) continue;
                var mine = string.Equals(path, exe, StringComparison.OrdinalIgnoreCase)
                           || (path.StartsWith('{') && path.EndsWith(@"\" + Path.GetFileName(exe), StringComparison.OrdinalIgnoreCase));
                if (mine && key.GetValue("IsPromoted") is null)
                    key.SetValue("IsPromoted", 1, RegistryValueKind.DWord);
            }
        }
        catch
        {
            // Not fatal: the icon stays in the overflow and can be pinned by hand.
        }
    }
}

static class StartupManager
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string Name = "TokkenMaxing";

    public static bool IsEnabled
    {
        get
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKey);
                return key?.GetValue(Name) is string;
            }
            catch
            {
                return false;
            }
        }
    }

    public static void Set(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (enabled) key.SetValue(Name, $"\"{Environment.ProcessPath}\"");
            else key.DeleteValue(Name, throwOnMissingValue: false);
        }
        catch
        {
            // Registry locked down: the checkbox simply won't stick.
        }
    }
}
