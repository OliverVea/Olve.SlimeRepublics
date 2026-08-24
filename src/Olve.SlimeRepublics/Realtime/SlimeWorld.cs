using System.Collections.Concurrent;
using System.Numerics;
using Microsoft.Extensions.Options;

namespace Olve.SlimeRepublics.Realtime;

/// <summary>One slime as it appears on the wire: an id and a position.</summary>
public readonly record struct SlimeState(uint Id, float X, float Y);

/// <summary>
/// The authoritative world. Deliberately trivial — slimes move in the direction their owner asked
/// for and are clamped to the arena — but the concurrency shape is the part that is meant to last.
/// <para>
/// <b>Exactly one thread mutates world state:</b> <see cref="WorldTickService"/>. Everything arriving
/// from a connection's read loop is deposited in a concurrent structure and picked up at the top of
/// the next tick. Joins and leaves queue as commands; movement intents overwrite a per-entity slot,
/// which is the correct lossiness — if a client sends three intents inside one tick, only the last
/// one was ever going to matter. The result is no locks on the hot path and no way for a slow or
/// hostile client to block the simulation.
/// </para>
/// </summary>
public sealed class SlimeWorld(IOptions<RealtimeOptions> options)
{
    private readonly RealtimeOptions _options = options.Value;
    private readonly ConcurrentQueue<Command> _commands = new();
    private readonly ConcurrentDictionary<uint, Vector2> _intents = new();

    // Touched only by the tick thread, after commands are drained.
    private readonly Dictionary<uint, Vector2> _positions = new();

    private uint _nextEntityId;
    private uint _tick;

    /// <summary>The tick the most recent snapshot described.</summary>
    public uint CurrentTick => Volatile.Read(ref _tick);

    /// <summary>
    /// Allocates an entity id and queues the spawn. The id is returned synchronously so the
    /// handshake can tell the client which slime is theirs before the first tick lands.
    /// </summary>
    public uint Join() 
    {
        var entityId = Interlocked.Increment(ref _nextEntityId);
        _commands.Enqueue(Command.Join(entityId));
        return entityId;
    }

    /// <summary>Queues the despawn and drops any pending intent for <paramref name="entityId"/>.</summary>
    public void Leave(uint entityId)
    {
        _intents.TryRemove(entityId, out _);
        _commands.Enqueue(Command.Leave(entityId));
    }

    /// <summary>
    /// Records the latest movement intent for <paramref name="entityId"/>, overwriting any intent
    /// not yet consumed. The direction is normalised here so a client cannot speed-hack by sending
    /// an oversized vector — the server decides how fast a slime moves, the client only says where.
    /// </summary>
    public void SetIntent(uint entityId, float x, float y)
    {
        var direction = new Vector2(x, y);
        if (!float.IsFinite(direction.X) || !float.IsFinite(direction.Y))
        {
            return;
        }

        var length = direction.Length();
        _intents[entityId] = length > 1f ? direction / length : direction;
    }

    /// <summary>
    /// Advances the simulation by <paramref name="deltaSeconds"/> and writes the resulting snapshot
    /// into <paramref name="destination"/>, returning its length. Called only by
    /// <see cref="WorldTickService"/>.
    /// </summary>
    public int Tick(float deltaSeconds, Span<byte> destination)
    {
        while (_commands.TryDequeue(out var command))
        {
            if (command.IsJoin)
            {
                _positions[command.EntityId] = SpawnPosition(command.EntityId, _options.ArenaHalfSize);
            }
            else
            {
                _positions.Remove(command.EntityId);
            }
        }

        var step = _options.MoveSpeed * deltaSeconds;
        var bound = _options.ArenaHalfSize;

        foreach (var entityId in _positions.Keys)
        {
            if (!_intents.TryGetValue(entityId, out var intent) || intent == Vector2.Zero)
            {
                continue;
            }

            var moved = _positions[entityId] + (intent * step);
            _positions[entityId] = new Vector2(
                Math.Clamp(moved.X, -bound, bound),
                Math.Clamp(moved.Y, -bound, bound));
        }

        var tick = unchecked(_tick + 1);
        Volatile.Write(ref _tick, tick);

        var count = Math.Min(_positions.Count, _options.MaxConnections);
        Span<SlimeState> slimes = count <= 64 ? stackalloc SlimeState[count] : new SlimeState[count];

        var index = 0;
        foreach (var (entityId, position) in _positions)
        {
            if (index == count)
            {
                break;
            }

            slimes[index++] = new SlimeState(entityId, position.X, position.Y);
        }

        return RealtimeProtocol.WriteSnapshot(destination, tick, slimes);
    }

    // Golden-angle spiral: spreads spawns evenly without a random source, so a given entity id
    // always spawns in the same place. Deterministic worlds are far easier to reason about in tests.
    private static Vector2 SpawnPosition(uint entityId, float arenaHalfSize)
    {
        const float GoldenAngle = 2.39996323f;
        var angle = entityId * GoldenAngle;
        var radius = arenaHalfSize * 0.5f * MathF.Sqrt(entityId % 64 / 64f);
        return new Vector2(radius * MathF.Cos(angle), radius * MathF.Sin(angle));
    }

    private readonly record struct Command(uint EntityId, bool IsJoin)
    {
        public static Command Join(uint entityId) => new(entityId, true);
        public static Command Leave(uint entityId) => new(entityId, false);
    }
}
