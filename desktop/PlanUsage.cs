using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace TokkenMaxing;

/// <summary>
/// Visual contract shared with the phone app (mobile/src/objective.ts and ring.ts): same scale, same thresholds.
///  - The ring is the plan usage shown by Claude (0-100 %).
///  - The objective is the % of the limit to have used when the window resets (100 % by default).
///    Paced over the window, it gives where the usage should be right now:
///    expected = objective × elapsed fraction. Weekly reset Saturday 08:00, objective 100 %:
///    on Tuesday 08:00, expected = 3/7 ≈ 43 %. The white dot on the ring marks it.
///  - The disc color compares the usage to that point (usage / expected) on <see cref="Scale"/>:
///    0 % of the objective on the left, 100 % (on pace, green) in the middle, 200 % on the right.
/// </summary>
public static class Palette
{
    /// <summary>From 0 % to 200 % of the objective, evenly spaced: 100 % is the green in the middle.</summary>
    public static readonly string[] Scale =
        ["#313695", "#4575b4", "#74add1", "#66c2a5", "#1a9850", "#a6d96a", "#fdd835", "#f46d43", "#a50026"];

    public const double ScaleMax = 2.0;     // right end of the scale: 200 % of the objective
    public const double OnPaceLow = 0.9;    // "dans le rythme" between 90 % and 110 %
    public const double OnPaceHigh = 1.1;

    public const string Idle = "#64748B";     // no data, or no window to pace against
    public const string Overflow = "#FACC15"; // beyond 100 % (extra usage)
    public const string Accent = "#38BDF8";   // links, bars
    public const string Marker = "#FFFFFF";   // the objective dot
    public const string Halo = "#0B1220";     // outline of the dot, dark ink on light discs

    public static string ColorForRatio(double ratio)
    {
        if (double.IsNaN(ratio)) ratio = 0;
        var t = Math.Clamp(ratio / ScaleMax, 0, 1) * (Scale.Length - 1);
        var i = Math.Min((int)Math.Floor(t), Scale.Length - 2);
        var f = t - i;
        var a = ToColor(Scale[i]);
        var b = ToColor(Scale[i + 1]);
        int Mix(int x, int y) => (int)Math.Round(x + (y - x) * f);
        return $"#{Mix(a.R, b.R):X2}{Mix(a.G, b.G):X2}{Mix(a.B, b.B):X2}";
    }

    public static string StatusFor(double? ratio) => ratio switch
    {
        null => "idle",
        < OnPaceLow => "under",
        <= OnPaceHigh => "on_track",
        _ => "over",
    };

    public static string WordFor(string status) => status switch
    {
        "under" => "Sous le rythme",
        "on_track" => "Dans le rythme",
        "over" => "Au-dessus du rythme",
        _ => "",
    };

    /// <summary>White text on dark discs, dark text on light ones (the scale has both).</summary>
    public static string InkFor(string hex)
    {
        var l = Luminance(ToColor(hex));
        return 1.05 / (l + 0.05) >= 3 ? "#FFFFFF" : Halo;
    }

    static double Luminance(Color c)
    {
        static double Lin(int v)
        {
            var s = v / 255.0;
            return s <= 0.03928 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * Lin(c.R) + 0.7152 * Lin(c.G) + 0.0722 * Lin(c.B);
    }

    public static Color ToColor(string hex) => ColorTranslator.FromHtml(hex);
}

// ---------------------------------------------------------------------------------------------
// Raw data, as returned by Claude's usage service (the one behind Claude Code's /usage).
// ---------------------------------------------------------------------------------------------

public sealed record UsageWindow(double Utilization, DateTimeOffset? ResetsAt);

public sealed record BreakdownRow(string Key, string Label, double PercentOfLimit);

public sealed record PlanSnapshot(
    string Source, // "live" (asked Claude just now) or "cache" (what Claude Code stored on disk)
    DateTimeOffset FetchedAt,
    UsageWindow? Session,
    UsageWindow? Weekly,
    IReadOnlyList<BreakdownRow> Breakdown)
{
    public static PlanSnapshot Parse(JsonElement root, string source, DateTimeOffset fetchedAt)
    {
        var rows = new List<BreakdownRow>();
        if (root.TryGetProperty("seven_day_breakdown", out var bd) && bd.ValueKind == JsonValueKind.Object
            && bd.TryGetProperty("rows", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var row in list.EnumerateArray())
            {
                var label = Str(row, "display_name") ?? Str(row, "key") ?? "?";
                rows.Add(new BreakdownRow(Str(row, "key") ?? label, label, Num(row, "percent_of_limit") ?? 0));
            }
        }
        return new PlanSnapshot(source, fetchedAt, Window(root, "five_hour"), Window(root, "seven_day"), rows);
    }

    static UsageWindow? Window(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var w) || w.ValueKind != JsonValueKind.Object) return null;
        var utilization = Num(w, "utilization");
        if (utilization is null) return null;
        DateTimeOffset? resets = Str(w, "resets_at") is { } s
            && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var r) ? r : null;
        return new UsageWindow(utilization.Value, resets);
    }

    static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    static double? Num(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : null;
}

/// <summary>
/// Gets the plan usage (session 5 h + weekly) of the Claude account Claude Code is logged into.
///  - live: GET api.anthropic.com/api/oauth/usage with Claude Code's OAuth token, read from
///    .credentials.json. The token is never refreshed or written here: refreshing rotates it and
///    could log Claude Code out. When it has expired, Claude Code renews it on its next start.
///  - cache: "cachedUsageUtilization" in ~/.claude.json, written by Claude Code itself.
/// The newest of the two wins.
/// </summary>
public sealed class PlanUsageClient
{
    const string Endpoint = "https://api.anthropic.com/api/oauth/usage";
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    public PlanSnapshot? Latest { get; private set; }

    /// <summary>Why the last live read failed (null when it worked).</summary>
    public string? Problem { get; private set; }

    /// <summary>After a 429, don't call again before this time.</summary>
    public DateTimeOffset NotBefore { get; private set; } = DateTimeOffset.MinValue;

    public DateTimeOffset? LastAttempt { get; private set; }

    static string ConfigDir =>
        Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR") is { Length: > 0 } dir
            ? dir
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude");

    static string CredentialsPath => Path.Combine(ConfigDir, ".credentials.json");

    static string GlobalConfigPath =>
        Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR") is { Length: > 0 } dir
            ? Path.Combine(dir, ".claude.json")
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude.json");

    public async Task RefreshAsync(CancellationToken ct = default)
    {
        LoadCache();
        if (DateTimeOffset.Now < NotBefore) return;
        LastAttempt = DateTimeOffset.Now;

        var (token, expiresAt) = ReadToken();
        if (token is null)
        {
            Problem = "Claude Code n'est pas connecté sur ce PC";
            return;
        }
        if (expiresAt is { } exp && exp <= DateTimeOffset.Now.AddSeconds(30))
        {
            Problem = "Jeton expiré : ouvre Claude Code pour le renouveler";
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, Endpoint);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.Add("anthropic-beta", "oauth-2025-04-20");
            request.Headers.UserAgent.ParseAdd("TokkenMaxing/1.0");
            request.Headers.Accept.ParseAdd("application/json");

            using var response = await Http.SendAsync(request, ct);
            switch (response.StatusCode)
            {
                case HttpStatusCode.OK:
                    var json = await response.Content.ReadAsStringAsync(ct);
                    using (var doc = JsonDocument.Parse(json))
                        Latest = PlanSnapshot.Parse(doc.RootElement, "live", DateTimeOffset.Now);
                    Problem = null;
                    break;
                case HttpStatusCode.Unauthorized:
                case HttpStatusCode.Forbidden:
                    Problem = "Jeton refusé : ouvre Claude Code pour te reconnecter";
                    break;
                case HttpStatusCode.TooManyRequests:
                    var wait = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromMinutes(10);
                    NotBefore = DateTimeOffset.Now + (wait < TimeSpan.FromMinutes(2) ? TimeSpan.FromMinutes(2) : wait);
                    Problem = $"Trop de requêtes, nouvel essai à {NotBefore:HH:mm}";
                    break;
                default:
                    Problem = $"Le service a répondu {(int)response.StatusCode}";
                    break;
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            Problem = ex is JsonException ? "Réponse illisible du service" : "Pas de connexion à Anthropic";
        }
    }

    /// <summary>Uses Claude Code's own cached copy if it is newer than what we have.</summary>
    public void LoadCache()
    {
        try
        {
            if (!File.Exists(GlobalConfigPath)) return;
            using var stream = new FileStream(GlobalConfigPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var doc = JsonDocument.Parse(stream);
            if (!doc.RootElement.TryGetProperty("cachedUsageUtilization", out var cached)) return;
            if (!cached.TryGetProperty("fetchedAtMs", out var ms) || !ms.TryGetInt64(out var fetchedMs)) return;
            if (!cached.TryGetProperty("utilization", out var utilization) || utilization.ValueKind != JsonValueKind.Object) return;

            var fetchedAt = DateTimeOffset.FromUnixTimeMilliseconds(fetchedMs).ToLocalTime();
            if (Latest is not null && Latest.FetchedAt >= fetchedAt) return;
            Latest = PlanSnapshot.Parse(utilization, "cache", fetchedAt);
        }
        catch (Exception)
        {
            // File being rewritten by Claude Code, or unexpected shape: keep what we have.
        }
    }

    static (string? token, DateTimeOffset? expiresAt) ReadToken()
    {
        try
        {
            if (!File.Exists(CredentialsPath)) return (null, null);
            using var stream = new FileStream(CredentialsPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var doc = JsonDocument.Parse(stream);
            if (!doc.RootElement.TryGetProperty("claudeAiOauth", out var oauth)) return (null, null);
            var token = oauth.TryGetProperty("accessToken", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
            DateTimeOffset? expires = oauth.TryGetProperty("expiresAt", out var e) && e.TryGetInt64(out var ms)
                ? DateTimeOffset.FromUnixTimeMilliseconds(ms)
                : null;
            return (string.IsNullOrEmpty(token) ? null : token, expires);
        }
        catch (Exception)
        {
            return (null, null);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// What the tray, the dashboard and the phone display.
// ---------------------------------------------------------------------------------------------

public sealed record LimitUsage(
    string Key,        // "session" | "weekly"
    string Label,      // "Session" | "Hebdo"
    double Percent,    // as shown by Claude, 0..100
    DateTimeOffset? ResetsAt,
    double? Pace,      // fraction of the window already elapsed
    int Target,        // the objective: % of the limit to have used at reset
    double? Expected,  // where the usage should be now: Target × Pace, in % (null: no window)
    double? Ratio,     // Percent / Expected: 1 = on pace, 2 = twice too fast
    double Progress,   // Percent / 100: how full the ring is
    double? Marker,    // Expected / 100: where the white dot sits on the ring
    string Status,     // "under" | "on_track" | "over" | "idle"
    string StatusLabel,
    string Color);

public sealed record UsageReport(
    string App,
    int Version,
    bool HasData,
    string Source,
    DateTimeOffset? FetchedAt,
    string? Problem,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<LimitUsage> Limits,
    IReadOnlyList<BreakdownRow> Breakdown)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public LimitUsage Session => Limits[0];

    [System.Text.Json.Serialization.JsonIgnore]
    public LimitUsage Weekly => Limits[1];
}

public static class UsageReportBuilder
{
    public static readonly TimeSpan SessionWindow = TimeSpan.FromHours(5);
    public static readonly TimeSpan WeekWindow = TimeSpan.FromDays(7);

    public static UsageReport Build(PlanUsageClient client, AppSettings settings)
    {
        var now = DateTimeOffset.Now;
        var snap = client.Latest;
        var hasData = snap is not null;

        var (sessionPercent, sessionResets) = Current(snap?.Session, weekly: false, anchor: null, now);
        var (weeklyPercent, weeklyResets) = Current(snap?.Weekly, weekly: true, settings.WeeklyResetAnchor, now);
        var limits = new List<LimitUsage>
        {
            Limit("session", "Session", sessionPercent, sessionResets, SessionWindow, settings.SessionTarget, hasData, now),
            Limit("weekly", "Hebdo", weeklyPercent, weeklyResets, WeekWindow, settings.WeeklyTarget, hasData, now),
        };
        return new UsageReport("TokkenMaxing", 3, hasData, snap?.Source ?? "none", snap?.FetchedAt,
            client.Problem, now, limits, snap?.Breakdown ?? []);
    }

    /// <summary>
    /// Usage and reset time as they are *now*. If the window rolled over since the last read, Claude
    /// counts from zero again. The weekly limit resets every 7 days at the same time (e.g. Saturday
    /// 08:00), so its next reset is known even then, or from the last one ever seen (anchor).
    /// </summary>
    static (double percent, DateTimeOffset? resets) Current(UsageWindow? w, bool weekly, DateTimeOffset? anchor, DateTimeOffset now)
    {
        var percent = w?.Utilization ?? 0;
        var resets = w?.ResetsAt;
        if (resets is { } r && r <= now)
        {
            percent = 0;
            resets = weekly ? NextWeeklyReset(r, now) : null;
        }
        if (resets is null && weekly && anchor is { } a) resets = NextWeeklyReset(a, now);
        return (percent, resets);
    }

    public static DateTimeOffset NextWeeklyReset(DateTimeOffset known, DateTimeOffset now)
    {
        if (known > now) return known;
        var weeks = (now - known).Ticks / WeekWindow.Ticks + 1;
        return known + TimeSpan.FromTicks(WeekWindow.Ticks * weeks);
    }

    static LimitUsage Limit(string key, string label, double percent, DateTimeOffset? resets, TimeSpan window,
        int target, bool hasData, DateTimeOffset now)
    {
        double? pace = resets is { } end
            ? Math.Clamp(1 - (end - now).TotalSeconds / window.TotalSeconds, 0, 1)
            : null;
        double? expected = hasData && pace is { } p ? target * p : null;
        double? ratio = expected switch
        {
            null => null,
            > 0 and var e => percent / e,
            _ => percent > 0 ? Palette.ScaleMax : 1, // the window has just started
        };

        var status = Palette.StatusFor(ratio);
        var label2 = !hasData ? "En attente de données"
            : ratio is null ? (key == "session" ? "Pas de session en cours" : "Réinitialisation inconnue")
            : Palette.WordFor(status);
        return new LimitUsage(key, label, Math.Round(percent, 1), resets, Round(pace, 4), target, Round(expected, 2),
            Round(ratio, 4), Math.Round(percent / 100, 4), Round(expected / 100, 4), status, label2,
            ratio is { } q ? Palette.ColorForRatio(q) : Palette.Idle);
    }

    static double? Round(double? v, int digits) => v is { } x ? Math.Round(x, digits) : null;
}

public static class Fmt
{
    static readonly CultureInfo Fr = CultureInfo.GetCultureInfo("fr-FR");

    public static string Percent(double percent) => Math.Floor(percent).ToString("0", Fr) + " %";

    /// <summary>"102 % de l'objectif" (usage / expected), or "" without a window.</summary>
    public static string Ratio(LimitUsage u) =>
        u.Ratio is { } r ? Whole(Math.Min(r, 9.99) * 100) + " % de l'objectif" : "";

    /// <summary>"Attendu maintenant : 43 %", or "" without a window.</summary>
    public static string Expected(LimitUsage u) =>
        u.Expected is { } e ? $"Attendu maintenant : {Whole(e)} %" : "";

    /// <summary>Rounded half up, like Math.round on the phone.</summary>
    public static string Whole(double v) => Math.Round(v, MidpointRounding.AwayFromZero).ToString("0", Fr);

    /// <summary>"dans 1 h 12", "dans 3 j 4 h".</summary>
    public static string Until(DateTimeOffset? when)
    {
        if (when is null) return "";
        var d = when.Value - DateTimeOffset.Now;
        if (d.TotalSeconds <= 0) return "maintenant";
        if (d.TotalMinutes < 60) return $"dans {Math.Max(1, (int)d.TotalMinutes)} min";
        if (d.TotalHours < 24) return $"dans {(int)d.TotalHours} h {d.Minutes:00}";
        return $"dans {(int)d.TotalDays} j {d.Hours} h";
    }

    /// <summary>"22:30" today, "sam. 08:00" otherwise.</summary>
    public static string Clock(DateTimeOffset? when)
    {
        if (when is null) return "";
        var local = when.Value.ToLocalTime();
        return local.Date == DateTime.Today ? local.ToString("HH:mm", Fr) : local.ToString("ddd HH:mm", Fr);
    }

    public static string Ago(DateTimeOffset? when)
    {
        if (when is null) return "jamais";
        var d = DateTimeOffset.Now - when.Value;
        if (d.TotalSeconds < 60) return "à l'instant";
        if (d.TotalMinutes < 60) return $"il y a {(int)d.TotalMinutes} min";
        if (d.TotalHours < 24) return $"il y a {(int)d.TotalHours} h";
        return $"il y a {(int)d.TotalDays} j";
    }

    public static string ResetShort(LimitUsage u) =>
        u.ResetsAt is null
            ? (u.Key == "session" ? "Pas de session en cours" : "")
            : $"Réinit. {Until(u.ResetsAt)}";

    public static string ResetLine(LimitUsage u) =>
        u.ResetsAt is null
            ? (u.Key == "session" ? "Pas de session en cours" : "")
            : $"Réinit. {Until(u.ResetsAt)} ({Clock(u.ResetsAt)})";
}
