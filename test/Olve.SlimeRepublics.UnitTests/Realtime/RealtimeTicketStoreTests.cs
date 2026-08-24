using System.Security.Claims;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Olve.SlimeRepublics.Realtime;

namespace Olve.SlimeRepublics.UnitTests.Realtime;

/// <summary>
/// The ticket is the only thing standing between an unauthenticated upgrade request and a live
/// connection, so these cover the properties that make it safe to put in a URL: single use, short
/// lived, and never outliving the token it was minted from.
/// </summary>
public class RealtimeTicketStoreTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private static (RealtimeTicketStore Store, FakeTimeProvider Time) Create(int ttlSeconds = 30)
    {
        var time = new FakeTimeProvider(Now);
        var options = Options.Create(new RealtimeOptions { TicketTtlSeconds = ttlSeconds });
        return (new RealtimeTicketStore(time, options), time);
    }

    private static RealtimeIdentity Identity(string subject = "user-1", int sessionMinutes = 5) =>
        new(subject, "Test User", Now.AddMinutes(sessionMinutes));

    [Test]
    public async Task Redeem_WithFreshTicket_ReturnsTheIssuedIdentity()
    {
        var (store, _) = Create();
        var issued = store.Issue(Identity());

        var redeemed = store.TryRedeem(issued.Ticket, out var identity);

        await Assert.That(redeemed).IsTrue();
        await Assert.That(identity.Subject).IsEqualTo("user-1");
        await Assert.That(identity.Name).IsEqualTo("Test User");
    }

    [Test]
    public async Task Redeem_Twice_FailsTheSecondTime()
    {
        var (store, _) = Create();
        var issued = store.Issue(Identity());

        await Assert.That(store.TryRedeem(issued.Ticket, out _)).IsTrue();
        await Assert.That(store.TryRedeem(issued.Ticket, out _)).IsFalse();
    }

    [Test]
    public async Task Redeem_AfterTtl_Fails()
    {
        var (store, time) = Create(ttlSeconds: 30);
        var issued = store.Issue(Identity());

        time.Advance(TimeSpan.FromSeconds(31));

        await Assert.That(store.TryRedeem(issued.Ticket, out _)).IsFalse();
    }

    [Test]
    public async Task Redeem_AfterUnderlyingTokenExpired_Fails()
    {
        // A ticket must never outlive its token, or a socket becomes a way to keep using a session
        // that HTTP would already have refused.
        var (store, time) = Create(ttlSeconds: 3600);
        var issued = store.Issue(Identity(sessionMinutes: 1));

        time.Advance(TimeSpan.FromMinutes(2));

        await Assert.That(store.TryRedeem(issued.Ticket, out _)).IsFalse();
    }

    [Test]
    [Arguments(null)]
    [Arguments("")]
    [Arguments("not-a-real-ticket")]
    public async Task Redeem_WithGarbage_Fails(string? ticket)
    {
        var (store, _) = Create();

        await Assert.That(store.TryRedeem(ticket, out _)).IsFalse();
    }

    [Test]
    public async Task Issue_ProducesDistinctTickets()
    {
        var (store, _) = Create();

        var tickets = Enumerable.Range(0, 100).Select(_ => store.Issue(Identity()).Ticket).ToList();

        await Assert.That(tickets.Distinct().Count()).IsEqualTo(100);
    }

    [Test]
    public async Task Issue_ReportsTheTokenExpiryNotTheTicketExpiry()
    {
        // The client schedules its HTTP refresh off this, so it has to describe the token.
        var (store, _) = Create(ttlSeconds: 30);

        var issued = store.Issue(Identity(sessionMinutes: 5));

        await Assert.That(issued.ExpiresInSeconds).IsEqualTo(30);
        await Assert.That(issued.SessionExpiresAtUnixSeconds).IsEqualTo(Now.AddMinutes(5).ToUnixTimeSeconds());
    }

    [Test]
    public async Task DescribeIdentity_ReadsSubjectAndExpiryFromClaims()
    {
        var (store, _) = Create();
        var expiry = Now.AddMinutes(10);
        var user = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim("sub", "abc-123"),
            new Claim("name", "Slime Fan"),
            new Claim("exp", expiry.ToUnixTimeSeconds().ToString()),
        ], "test"));

        var identity = store.DescribeIdentity(user);

        await Assert.That(identity.Subject).IsEqualTo("abc-123");
        await Assert.That(identity.Name).IsEqualTo("Slime Fan");
        await Assert.That(identity.SessionExpiresAt.ToUnixTimeSeconds()).IsEqualTo(expiry.ToUnixTimeSeconds());
    }

    [Test]
    public async Task DescribeIdentity_WithoutExpClaim_CapsAtTheTicketTtl()
    {
        // No exp means no evidence the session is long-lived, so it gets the shortest defensible life.
        var (store, _) = Create(ttlSeconds: 30);
        var user = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "abc-123")], "test"));

        var identity = store.DescribeIdentity(user);

        await Assert.That(identity.SessionExpiresAt).IsEqualTo(Now.AddSeconds(30));
    }
}
