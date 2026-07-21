# Local build: produces managed + unmanaged solution zips in solution/bin/Release
$ErrorActionPreference = "Stop"
npm ci --prefix src/controls/ConversationAnalyzer
npm ci --prefix src/controls/RoutingOverview
if (-not (Test-Path "src/plugin/ConversationDiagnostics.Plugins/ConversationDiagnostics.snk")) {
    Write-Host "Generating strong-name key..."
    dotnet tool restore 2>$null
    # sn.exe path varies; fall back to 'sn' on PATH
    sn -k src/plugin/ConversationDiagnostics.Plugins/ConversationDiagnostics.snk
}
dotnet build solution/ConversationDiagnostics.cdsproj -c Release
Write-Host "Solutions in solution/bin/Release"
