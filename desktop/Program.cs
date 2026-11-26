using System.Text.Json;

namespace TokkenMaxing;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        // Tooling entry points (no UI):
        //   TokkenMaxing.exe --dump report.json             ask Claude once and write the report as JSON
        //   TokkenMaxing.exe --render-assets <mobile/assets> <app.ico>   render icons from the same ring code
        if (args is ["--dump", var output])
        {
            var client = new PlanUsageClient();
            client.RefreshAsync().GetAwaiter().GetResult();
            var report = UsageReportBuilder.Build(client, AppSettings.Load());
            File.WriteAllText(output, JsonSerializer.Serialize(report, new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping, // keep accents readable
                WriteIndented = true,
            }));
            return 0;
        }
        if (args is ["--render-assets", var assetsDir, var icoPath])
        {
            AssetExporter.Export(assetsDir, icoPath);
            return 0;
        }
        if (args is ["--preview", var previewDir])
        {
            ApplicationConfiguration.Initialize();
            Preview.Render(previewDir);
            return 0;
        }

        using var mutex = new Mutex(initiallyOwned: true, @"Local\TokkenMaxing.Tray", out var firstInstance);
        if (!firstInstance) return 0;

        ApplicationConfiguration.Initialize();
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        Application.Run(new TrayContext());
        return 0;
    }
}
