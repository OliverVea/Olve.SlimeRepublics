using Olve.SlimeRepublics.Configuration;
using Olve.SlimeRepublics.Health;
using Olve.SlimeRepublics.Messages;
using Olve.SlimeRepublics.Realtime;
using Olve.Utilities.AsyncOnStartup;

var builder = WebApplication.CreateSlimBuilder(args);

builder.ConfigureHost(args);
builder.ConfigureJson();
builder.ConfigureAuthentication();
builder.ConfigureTelemetry();
builder.Services.AddMessageServices(builder.Configuration);
builder.Services.AddRealtimeServices(builder.Configuration);

var app = builder.Build();

// Serve the SPA (frontend/dist, copied into wwwroot by the Dockerfile) at the site root.
// Static assets and the index fallback are anonymous — the RequireAuthenticatedUser fallback
// policy would otherwise 401 them. In local dev the SPA is served by Vite (`npm run dev`),
// so wwwroot is only populated in the container and this no-ops when running `dotnet run`.
app.UseDefaultFiles();
app.UseStaticFiles();

// Must precede the realtime endpoint: this is the middleware that turns a request carrying the
// Upgrade header into an AcceptWebSocketAsync-able context. KeepAliveInterval is the protocol-level
// ping Kestrel sends on an otherwise idle socket; the application heartbeat in RealtimeConnection is
// separate and exists to detect a peer that is connected but no longer responding.
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });

app.MapJson();
app.MapAuthentication();
app.MapHealthEndpoints();

// The JSON API lives under /api/ so the SPA can own the site root (/, /index.html, assets).
var api = app.MapGroup("/api");
api.MapMessageEndpoints();
api.MapFrontendConfig();
api.MapRealtimeTicketEndpoint();

// The socket lives at the site root, not under /api — it is not a JSON API and is not described
// by api.json. Mapping it explicitly also keeps it clear of MapFallbackToFile below.
app.MapRealtimeEndpoint();

// SPA client-side routing: any unmatched non-API GET returns index.html so deep links work.
app.MapFallbackToFile("index.html").AllowAnonymous();

// Start the host (the persister loads its snapshot here), then run one-shot startup tasks
// against the populated stores, then block until shutdown.
await app.StartAsync();
await app.Services.RunAsyncOnStartup();
await app.WaitForShutdownAsync();

public partial class Program;
