using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace TokkenMaxing;

/// <summary>
/// Minimal HTTP server for the phone app. TcpListener (not HttpListener) so it can
/// listen on the LAN without admin rights or a URL ACL.
///   GET  /api/ping     -> {"app":"TokkenMaxing"}         (no code needed: reachability check)
///   GET  /api/usage    -> UsageReport JSON                (Authorization: Bearer CODE or ?code=CODE)
///   POST /api/targets?session=80&amp;weekly=100 -> UsageReport JSON   (same code; the only thing the phone can change)
/// </summary>
public sealed class ApiServer : IDisposable
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping, // keep accents readable
    };

    readonly Func<UsageReport?> _report;
    readonly Func<string> _accessCode;
    readonly Func<int?, int?, Task<UsageReport?>> _setTargets;
    readonly CancellationTokenSource _cts = new();
    TcpListener? _listener;

    public int Port { get; }
    public string? Error { get; private set; }
    public bool Running => _listener is not null && Error is null;

    public ApiServer(int port, Func<UsageReport?> report, Func<string> accessCode, Func<int?, int?, Task<UsageReport?>> setTargets)
    {
        Port = port;
        _report = report;
        _accessCode = accessCode;
        _setTargets = setTargets;
    }

    public void Start()
    {
        try
        {
            _listener = new TcpListener(IPAddress.Any, Port);
            _listener.Start();
            _ = AcceptLoop(_cts.Token);
        }
        catch (SocketException ex)
        {
            Error = ex.SocketErrorCode == SocketError.AddressAlreadyInUse
                ? $"Le port {Port} est déjà utilisé"
                : ex.Message;
            _listener = null;
        }
    }

    async Task AcceptLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _listener is not null)
        {
            TcpClient client;
            try { client = await _listener.AcceptTcpClientAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (SocketException) { continue; }
            _ = Task.Run(() => HandleAsync(client, ct), ct);
        }
    }

    async Task HandleAsync(TcpClient client, CancellationToken ct)
    {
        using (client)
        {
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(5));
                var stream = client.GetStream();

                var head = await ReadHeadAsync(stream, timeout.Token);
                if (head is null) return;

                var lines = head.Split("\r\n");
                var parts = lines[0].Split(' ');
                if (parts.Length < 2)
                {
                    await WriteAsync(stream, 400, new { error = "bad_request" }, timeout.Token);
                    return;
                }

                var method = parts[0].ToUpperInvariant();
                var target = parts[1];
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var line in lines.Skip(1))
                {
                    var colon = line.IndexOf(':');
                    if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
                }

                var q = target.IndexOf('?');
                var path = (q >= 0 ? target[..q] : target).TrimEnd('/').ToLowerInvariant();
                var query = q >= 0 ? ParseQuery(target[(q + 1)..]) : new Dictionary<string, string>();

                if (method == "OPTIONS")
                {
                    await WriteAsync(stream, 204, null, timeout.Token);
                    return;
                }
                if (method == "POST" && path == "/api/targets")
                {
                    if (!Authorized(headers, query))
                    {
                        await WriteAsync(stream, 401, new { error = "bad_code" }, timeout.Token);
                        return;
                    }
                    var session = Target(query, "session");
                    var weekly = Target(query, "weekly");
                    if (session is null && weekly is null)
                    {
                        await WriteAsync(stream, 400, new { error = "bad_target" }, timeout.Token);
                        return;
                    }
                    var updated = await _setTargets(session, weekly).WaitAsync(timeout.Token);
                    if (updated is null) await WriteAsync(stream, 503, new { error = "starting" }, timeout.Token);
                    else await WriteAsync(stream, 200, updated, timeout.Token);
                    return;
                }
                if (method != "GET")
                {
                    await WriteAsync(stream, 405, new { error = "method_not_allowed" }, timeout.Token);
                    return;
                }

                switch (path)
                {
                    case "/api/ping":
                        await WriteAsync(stream, 200, new { app = "TokkenMaxing", version = 2 }, timeout.Token);
                        break;
                    case "/api/usage":
                        if (!Authorized(headers, query))
                        {
                            await WriteAsync(stream, 401, new { error = "bad_code" }, timeout.Token);
                            break;
                        }
                        var report = _report();
                        if (report is null) await WriteAsync(stream, 503, new { error = "starting" }, timeout.Token);
                        else await WriteAsync(stream, 200, report, timeout.Token);
                        break;
                    default:
                        await WriteAsync(stream, 404, new { error = "not_found" }, timeout.Token);
                        break;
                }
            }
            catch (Exception)
            {
                // Client went away, timed out or sent garbage: nothing to do.
            }
        }
    }

    bool Authorized(Dictionary<string, string> headers, Dictionary<string, string> query)
    {
        string? given = null;
        if (headers.TryGetValue("Authorization", out var auth) && auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            given = auth[7..].Trim();
        else if (query.TryGetValue("code", out var c))
            given = c;
        if (string.IsNullOrEmpty(given)) return false;

        var expected = Encoding.UTF8.GetBytes(_accessCode().ToUpperInvariant());
        var actual = Encoding.UTF8.GetBytes(given.ToUpperInvariant());
        return CryptographicOperations.FixedTimeEquals(expected, actual);
    }

    /// <summary>An objective between 1 and 100 %, or null if absent or not a number.</summary>
    static int? Target(Dictionary<string, string> query, string name) =>
        query.TryGetValue(name, out var raw) && int.TryParse(raw, System.Globalization.NumberStyles.Integer,
            System.Globalization.CultureInfo.InvariantCulture, out var v)
            ? Math.Clamp(v, 1, 100)
            : null;

    static async Task<string?> ReadHeadAsync(NetworkStream stream, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(length), ct);
            if (read == 0) return null;
            length += read;
            var end = buffer.AsSpan(0, length).IndexOf("\r\n\r\n"u8);
            if (end >= 0) return Encoding.ASCII.GetString(buffer, 0, end);
        }
        return null; // headers too large
    }

    static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=');
            var key = Uri.UnescapeDataString(eq >= 0 ? pair[..eq] : pair);
            result[key] = eq >= 0 ? Uri.UnescapeDataString(pair[(eq + 1)..].Replace('+', ' ')) : "";
        }
        return result;
    }

    static async Task WriteAsync(NetworkStream stream, int status, object? body, CancellationToken ct)
    {
        var payload = body is null ? [] : JsonSerializer.SerializeToUtf8Bytes(body, body.GetType(), Json);
        var reason = status switch
        {
            200 => "OK", 204 => "No Content", 400 => "Bad Request", 401 => "Unauthorized",
            404 => "Not Found", 405 => "Method Not Allowed", 503 => "Service Unavailable", _ => "OK",
        };
        var head =
            $"HTTP/1.1 {status} {reason}\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            $"Content-Length: {payload.Length}\r\n" +
            "Cache-Control: no-store\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Headers: Authorization\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Connection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(head), ct);
        if (payload.Length > 0) await stream.WriteAsync(payload, ct);
        await stream.FlushAsync(ct);
    }

    /// <summary>IPv4 addresses the phone can use, most likely first (interfaces with a gateway).</summary>
    public static List<string> LanAddresses()
    {
        var found = new List<(string ip, int rank)>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                var props = nic.GetIPProperties();
                var hasGateway = props.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork
                                                                && !g.Address.Equals(IPAddress.Any));
                var name = (nic.Name + " " + nic.Description).ToLowerInvariant();
                var isVirtual = name.Contains("virtual") || name.Contains("vethernet") || name.Contains("vmware")
                                || name.Contains("hyper-v") || name.Contains("wsl") || name.Contains("docker");
                foreach (var a in props.UnicastAddresses)
                {
                    if (a.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    if (IsTailscale(a.Address)) continue; // see TailscaleAddress()
                    var ip = a.Address.ToString();
                    if (ip.StartsWith("169.254.")) continue;
                    var rank = (hasGateway ? 0 : 2) + (isVirtual ? 4 : 0)
                               + (nic.NetworkInterfaceType == NetworkInterfaceType.Wireless80211 ? 0 : 1);
                    found.Add((ip, rank));
                }
            }
        }
        catch
        {
            // ignore
        }
        return found.OrderBy(f => f.rank).Select(f => f.ip).Distinct().ToList();
    }

    /// <summary>Tailscale gives each device an address in 100.64.0.0/10 (CGNAT range).</summary>
    public const string TailscaleRange = "100.64.0.0/10";

    static bool IsTailscale(IPAddress ip)
    {
        var b = ip.GetAddressBytes();
        return b.Length == 4 && b[0] == 100 && (b[1] & 0xC0) == 64;
    }

    /// <summary>
    /// This PC's Tailscale address, if Tailscale is running: reachable by the phone from anywhere
    /// (4G, another Wi-Fi) as long as the phone is on the same tailnet. Traffic is end-to-end encrypted.
    /// </summary>
    public static string? TailscaleAddress()
    {
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                foreach (var a in nic.GetIPProperties().UnicastAddresses)
                    if (a.Address.AddressFamily == AddressFamily.InterNetwork && IsTailscale(a.Address))
                        return a.Address.ToString();
            }
        }
        catch
        {
            // ignore
        }
        return null;
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { _listener?.Stop(); } catch { }
        _listener = null;
    }
}
