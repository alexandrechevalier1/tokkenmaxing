using System.Text.Json;

namespace TokkenMaxing;

/// <summary>User settings, persisted as JSON in %APPDATA%\TokkenMaxing\settings.json.</summary>
public sealed class AppSettings
{
    /// <summary>
    /// Objective for the 5-hour session: % of the limit to have used when it resets.
    /// Paced over the window, it places the white dot on the ring (see Palette).
    /// </summary>
    public int SessionTarget { get; set; } = 100;

    /// <summary>Objective for the week, same meaning. Default: use 100 % of the week by its reset.</summary>
    public int WeeklyTarget { get; set; } = 100;

    /// <summary>
    /// Last weekly reset time Claude reported. The weekly limit resets every 7 days at the same time,
    /// so this still places the objective when Claude gives no reset time (e.g. nothing used yet).
    /// </summary>
    public DateTimeOffset? WeeklyResetAnchor { get; set; }

    /// <summary>Which rings sit in the taskbar.</summary>
    public bool TraySession { get; set; } = true;
    public bool TrayWeekly { get; set; } = true;

    /// <summary>How often Claude is asked for fresh numbers (seconds, minimum 60).</summary>
    public int RefreshSeconds { get; set; } = 120;

    public static string Dir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TokkenMaxing");

    static string FilePath => Path.Combine(Dir, "settings.json");

    static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    public int TargetFor(string key) => key == "weekly" ? WeeklyTarget : SessionTarget;

    /// <summary>Stores the weekly reset Claude reported (to the nearest minute). True when it changed.</summary>
    public bool RememberWeeklyReset(DateTimeOffset? resetsAt)
    {
        if (resetsAt is not { } r) return false;
        var ticks = (r.UtcTicks + TimeSpan.TicksPerMinute / 2) / TimeSpan.TicksPerMinute * TimeSpan.TicksPerMinute;
        var rounded = new DateTimeOffset(ticks, TimeSpan.Zero);
        if (WeeklyResetAnchor == rounded) return false;
        WeeklyResetAnchor = rounded;
        Save();
        return true;
    }

    public static AppSettings Load()
    {
        AppSettings s;
        try
        {
            s = File.Exists(FilePath)
                ? JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath), JsonOptions) ?? new()
                : new();
        }
        catch
        {
            s = new();
        }

        s.SessionTarget = Math.Clamp(s.SessionTarget, 1, 100);
        s.WeeklyTarget = Math.Clamp(s.WeeklyTarget, 1, 100);
        if (!s.TraySession && !s.TrayWeekly) s.TraySession = s.TrayWeekly = true;
        s.RefreshSeconds = Math.Max(60, s.RefreshSeconds);

        // Rewritten at once: drops the settings of the old phone link (ServerEnabled, Port, AccessCode).
        s.Save();
        return s;
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, JsonOptions));
            File.Move(tmp, FilePath, overwrite: true);
        }
        catch
        {
            // Settings are a convenience; never crash the tray app over them.
        }
    }
}
