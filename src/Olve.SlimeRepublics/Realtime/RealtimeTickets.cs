using System.Buffers.Text;
using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.Extensions.Options;

namespace Olve.SlimeRepublics.Realtime;

/// <summary>
/// Who a connection is, captured from the bearer token at ticket-issue time. <see cref="SessionExpiresAt"/>
/// is the underlying token's <c>exp</c> — the connection can never outlive it, which is what stops a
/// long-lived socket from becoming an end-run around token expiry.
/// </summary>
public sealed record RealtimeIdentity(string Subject, string? Name, DateTimeOffset SessionExpiresAt);

/// <summary>The body of <c>POST /api/realtime/ticket</c>.</summary>
/// <param name="Ticket">Opaque, single-use, passed as the <c>ticket</c> query parameter on the upgrade.</param>
/// <param name="ExpiresInSeconds">How long the ticket stays redeemable.</param>
/// <param name="SessionExpiresAtUnixSeconds">
/// When the underlying token lapses. The client schedules its HTTP refresh and follow-up
/// <see cref="RealtimeProtocol.ReAuth"/> against this.
/// </param>
public sealed record RealtimeTicketResponse(string Ticket, int ExpiresInSeconds, long SessionExpiresAtUnixSeconds);

/// <summary>
/// Issues and redeems the single-use tickets that authenticate a WebSocket upgrade.
/// <para>
/// The browser <c>WebSocket</c> constructor cannot set an <c>Authorization</c> header, so the token
/// has to reach the server some other way. Putting the JWT in the query string works but writes it
/// into proxy access logs, browser history and <c>Referer</c> headers, where it stays valid for its
/// full lifetime. A ticket is a random 256-bit string that is worthless a second time and dead
/// within <see cref="RealtimeOptions.TicketTtlSeconds"/>, so HTTP keeps sole custody of the real
/// credential.
/// </para>
/// <para>
/// In-memory by design: tickets live seconds, and the connection they authorise is pinned to this
/// process anyway. A multi-node deployment needs a shared store — see <c>docs/REALTIME.md</c> §8.
/// </para>
/// </summary>
public sealed class RealtimeTicketStore(TimeProvider timeProvider, IOptions<RealtimeOptions> options)
{
    private const int TicketBytes = 32;
    private const int SweepThreshold = 64;

    private readonly ConcurrentDictionary<string, Entry> _tickets = new(StringComparer.Ordinal);
    private readonly RealtimeOptions _options = options.Value;

    /// <summary>Mints a ticket for <paramref name="identity"/>, valid for one redemption.</summary>
    public RealtimeTicketResponse Issue(RealtimeIdentity identity)
    {
        if (_tickets.Count > SweepThreshold)
        {
            Sweep();
        }

        var ticket = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(TicketBytes));
        var ttl = TimeSpan.FromSeconds(_options.TicketTtlSeconds);
        _tickets[ticket] = new Entry(identity, timeProvider.GetUtcNow() + ttl);

        return new RealtimeTicketResponse(
            ticket,
            _options.TicketTtlSeconds,
            identity.SessionExpiresAt.ToUnixTimeSeconds());
    }

    /// <summary>
    /// Redeems <paramref name="ticket"/>, removing it whether or not it had expired — a ticket is
    /// never valid twice, so a replayed one must fail even if it arrives inside the TTL.
    /// </summary>
    public bool TryRedeem(string? ticket, out RealtimeIdentity identity)
    {
        identity = null!;
        if (string.IsNullOrEmpty(ticket) || !_tickets.TryRemove(ticket, out var entry))
        {
            return false;
        }

        var now = timeProvider.GetUtcNow();
        if (entry.ExpiresAt <= now || entry.Identity.SessionExpiresAt <= now)
        {
            return false;
        }

        identity = entry.Identity;
        return true;
    }

    /// <summary>
    /// Reads the identity out of an authenticated principal. The <c>exp</c> claim is unix seconds
    /// per RFC 7519; a token without one is capped at the ticket TTL rather than trusted forever.
    /// </summary>
    public RealtimeIdentity DescribeIdentity(ClaimsPrincipal user)
    {
        var subject = user.FindFirst("sub")?.Value
            ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? user.Identity?.Name
            ?? "anonymous";

        var name = user.FindFirst("name")?.Value ?? user.FindFirst(ClaimTypes.Name)?.Value;

        var expiresAt = long.TryParse(user.FindFirst("exp")?.Value, out var exp)
            ? DateTimeOffset.FromUnixTimeSeconds(exp)
            : timeProvider.GetUtcNow().AddSeconds(_options.TicketTtlSeconds);

        return new RealtimeIdentity(subject, name, expiresAt);
    }

    private void Sweep()
    {
        var now = timeProvider.GetUtcNow();
        foreach (var (key, entry) in _tickets)
        {
            if (entry.ExpiresAt <= now)
            {
                _tickets.TryRemove(key, out _);
            }
        }
    }

    private readonly record struct Entry(RealtimeIdentity Identity, DateTimeOffset ExpiresAt);
}
