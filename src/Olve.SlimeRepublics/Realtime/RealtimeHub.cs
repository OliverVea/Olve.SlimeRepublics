using System.Collections.Concurrent;
using Microsoft.Extensions.Options;

namespace Olve.SlimeRepublics.Realtime;

/// <summary>
/// The registry of live connections and the one place a frame goes out to everybody.
/// <para>
/// <b>This is the interest-management seam.</b> Today <see cref="Broadcast"/> hands every connection
/// the same <see cref="ReadOnlyMemory{T}"/> — the snapshot is encoded once per tick and shared by
/// reference, so N clients cost N enqueues and zero extra bytes of work. That stops scaling the
/// moment the world is bigger than one screen, and the fix goes exactly here: replace the shared
/// frame with <c>view.For(connection)</c> and the rest of the stack is unchanged. Keeping the seam
/// down to a single method is the point of naming it now.
/// </para>
/// </summary>
public sealed class RealtimeHub(IOptions<RealtimeOptions> options, ILogger<RealtimeHub> logger)
{
    private readonly ConcurrentDictionary<uint, RealtimeConnection> _connections = new();
    private readonly RealtimeOptions _options = options.Value;

    /// <summary>Number of live connections.</summary>
    public int Count => _connections.Count;

    /// <summary>
    /// Registers <paramref name="connection"/>, or refuses it if the server is at
    /// <see cref="RealtimeOptions.MaxConnections"/>. The ceiling is enforced here rather than at the
    /// upgrade so there is a single source of truth for "how many are connected".
    /// </summary>
    public bool TryAdd(RealtimeConnection connection)
    {
        if (_connections.Count >= _options.MaxConnections)
        {
            logger.LogWarning("Realtime connection refused: at capacity ({MaxConnections})", _options.MaxConnections);
            return false;
        }

        return _connections.TryAdd(connection.EntityId, connection);
    }

    /// <summary>Unregisters a connection. Idempotent — teardown can arrive from either loop.</summary>
    public void Remove(uint entityId) => _connections.TryRemove(entityId, out _);

    /// <summary>
    /// Fans a frame out to every connection. Never blocks and never throws: each enqueue is a
    /// non-failing write to a bounded queue, so one wedged client cannot delay the tick.
    /// </summary>
    public void Broadcast(ReadOnlyMemory<byte> frame)
    {
        foreach (var connection in _connections.Values)
        {
            connection.Enqueue(frame);
        }
    }
}
