using System.Net.WebSockets;
using System.Security.Claims;
using Microsoft.Extensions.Options;
using Olve.MinimalApi;
using Olve.Results;
// Olve.Results declares its own `Results` type, which shadows the minimal-API one.
using Http = Microsoft.AspNetCore.Http.Results;

namespace Olve.SlimeRepublics.Realtime;

/// <summary>
/// Wires up the realtime slice: the HTTP ticket endpoint and the WebSocket upgrade.
/// <para>
/// <b>The division of labour.</b> HTTP owns the credential end to end — OIDC login, refresh, and the
/// ticket that proves a live token exists. The socket never sees a JWT, never refreshes anything,
/// and carries no auth material after the handshake beyond the occasional
/// <see cref="RealtimeProtocol.ReAuth"/> ticket. That keeps the hot path free of auth work while
/// leaving token lifetime firmly under HTTP's control.
/// </para>
/// </summary>
public static class RealtimeEndpoints
{
    /// <summary>The upgrade path. Outside the <c>/api</c> group, which is for the JSON API.</summary>
    public const string SocketPath = "/ws";

    /// <summary>Registers the world, hub, ticket store and tick loop.</summary>
    public static void AddRealtimeServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<RealtimeOptions>(configuration.GetSection(RealtimeOptions.SectionName));
        services.TryAddSingletonTimeProvider();
        services.AddSingleton<SlimeWorld>();
        services.AddSingleton<RealtimeHub>();
        services.AddSingleton<RealtimeTicketStore>();
        services.AddHostedService<WorldTickService>();
    }

    private static void TryAddSingletonTimeProvider(this IServiceCollection services)
    {
        if (services.All(descriptor => descriptor.ServiceType != typeof(TimeProvider)))
        {
            services.AddSingleton(TimeProvider.System);
        }
    }

    /// <summary>
    /// Maps <c>POST /realtime/ticket</c>. Inherits the app's <c>RequireAuthenticatedUser</c> fallback
    /// policy, so a caller must already hold a valid bearer token — this endpoint is the only bridge
    /// between HTTP's credential and the socket's.
    /// </summary>
    public static void MapRealtimeTicketEndpoint(this IEndpointRouteBuilder app)
    {
        app.MapPost("/realtime/ticket", (ClaimsPrincipal user, RealtimeTicketStore tickets) =>
                Result<RealtimeTicketResponse>.Success(tickets.Issue(tickets.DescribeIdentity(user))))
            .WithName("CreateRealtimeTicket")
            .WithResultMapping<RealtimeTicketResponse>();
    }

    /// <summary>
    /// Maps the WebSocket upgrade at <see cref="SocketPath"/>.
    /// <para>
    /// <c>AllowAnonymous</c> is load-bearing, not laziness: the app's fallback policy would reject
    /// the upgrade before the handler ran, and a rejected upgrade reaches browser JavaScript as a
    /// bare "connection failed" with no status and no body — so the 401 would be invisible. The
    /// ticket redeemed below is the authentication.
    /// </para>
    /// </summary>
    public static void MapRealtimeEndpoint(this WebApplication app)
    {
        app.MapGet(SocketPath, HandleUpgradeAsync)
            .AllowAnonymous()
            // OpenAPI has no vocabulary for an upgraded connection, so documenting it would only
            // produce a misleading GET in api.json and a dead method on every generated client.
            // The wire format lives in docs/REALTIME.md instead.
            .ExcludeFromDescription();
    }

    private static async Task<IResult> HandleUpgradeAsync(
        HttpContext context,
        RealtimeTicketStore tickets,
        RealtimeHub hub,
        SlimeWorld world,
        IOptions<RealtimeOptions> options,
        TimeProvider timeProvider,
        ILoggerFactory loggerFactory,
        string? ticket)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            return Http.BadRequest("This endpoint requires a WebSocket upgrade.");
        }

        var logger = loggerFactory.CreateLogger("Olve.SlimeRepublics.Realtime");

        if (!tickets.TryRedeem(ticket, out var identity))
        {
            logger.LogDebug("Realtime upgrade rejected: ticket missing, expired or already redeemed");
            return Http.Unauthorized();
        }

        var entityId = world.Join();
        using var socket = await context.WebSockets.AcceptWebSocketAsync();

        var connection = new RealtimeConnection(
            socket, entityId, identity, world, tickets, options, timeProvider, logger);

        if (!hub.TryAdd(connection))
        {
            world.Leave(entityId);
            await socket.CloseAsync(
                (WebSocketCloseStatus)RealtimeCloseCodes.ServerFull, "server full", CancellationToken.None);
            return Http.Empty;
        }

        logger.LogInformation(
            "Realtime connection opened: entity {EntityId} subject {Subject} ({Connections} live)",
            entityId, identity.Subject, hub.Count);

        try
        {
            await connection.RunAsync(context.RequestAborted);
        }
        finally
        {
            hub.Remove(entityId);
            world.Leave(entityId);
            logger.LogInformation(
                "Realtime connection closed: entity {EntityId} after {Dropped} dropped frames ({Connections} live)",
                entityId, connection.DroppedFrames, hub.Count);
        }

        // The response was hijacked by the upgrade; there is nothing left to write.
        return Http.Empty;
    }
}
