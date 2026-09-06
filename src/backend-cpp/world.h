// The simulation. Owns all game state and advances it.
//
// This header must never reference uWebSockets, uSockets or libuv. The world
// does not know it is being served over a network — the transport enqueues
// commands into it and drains events out of it, and nothing else. That rule is
// what keeps Tick() testable headless, and what would make moving the
// simulation onto its own thread a move rather than a rewrite.
//
// CMake enforces it: the slime_world target does not link uwebsockets.
//
// slime_world is header-only (an INTERFACE target) — everything lives in this file,
// so there is no second file to keep in step while the simulation is moving fast.
#pragma once

#include <cmath>
#include <print>
#include <ranges>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <entt/entt.hpp>

#include "common_generated.h"

namespace slime {
    // Stable network id. The entt::entity handle is an internal detail and may be
    // recycled; this never is.
    using SlimeId = std::uint32_t;

    // ---------------------------------------------------------------- components

    struct Position {
        int x = 0, y = 0;
    };

    struct Movable {
        float speed = 1.0f;
        float time_until = 0.0f;
    };

    struct Networked {
        SlimeId id = 0;
    };

    // ------------------------------------------------------------------ commands

    struct Spawn {
        SlimeId id;
    };

    struct Despawn {
        SlimeId id;
    };

    // -------------------------------------------------------------------- events

    struct Events {

        void clear() {
        }
    };

    // --------------------------------------------------------------------- world

    class World {
    private:
        std::unordered_map<SlimeId, entt::entity> entities_;

        float t_ = 0;

        entt::registry registry_;
        Events events_;

        std::vector<Spawn> spawns_;
        std::vector<Despawn> despawns_;

    public:
        void Enqueue(Spawn cmd) { spawns_.push_back(cmd); }
        void Enqueue(Despawn cmd) { despawns_.push_back(cmd); }

        // Defined inline: slime_world is header-only, so this is the only file to edit.
        void Tick(float dt) {
            events_.clear();
            ApplyCommands();

            t_ += dt;

            // const auto view = registry_.view<Position>();
            // view.each([this](Position &position) {
            //     position = Position((int) (std::round(t_ / 10.0f)), 1);
            //     std::println("pos: {}, {}", position.x, position.y);
            // });
        }

        const Events &events() const { return events_; }

        const entt::registry &registry() const { return registry_; }

        auto GetSlimesWithPositions() const {
            return registry_.view<const Networked, const Position>().each()
                   | std::views::transform([](auto &&t) { return std::pair{std::get<1>(t).id, std::get<2>(t)}; });
        }

        void ApplyCommands() {
            for (const Spawn &cmd: spawns_) {
                const entt::entity entity = registry_.create();
                registry_.emplace<Networked>(entity, cmd.id);
                registry_.emplace<Position>(entity, Position(0, 0));
                entities_[cmd.id] = entity;
            }

            spawns_.clear();

            const auto to_despawn = std::ranges::to<std::unordered_set>(
                despawns_ | std::views::transform(&Despawn::id));

            for (const auto [entity, networked]: registry_.view<Networked>().each()) {
                if (to_despawn.contains(networked.id)) {
                    registry_.destroy(entity);
                }
            }

            despawns_.clear();
        }

        void MoveSlime(SlimeId slimeId, SlimeRepublics::Direction direction) {
            if (!entities_.contains(slimeId)) {
                std::println("Failed to get entity with id {}", slimeId);
                return;
            }

            const auto entity = entities_[slimeId];

            auto&& [networked, position] = registry_.view<const Networked, Position>().get(entity);

            switch (direction) {
                case SlimeRepublics::Direction::Up:
                    position = Position(position.x, position.y + 1);
                    break;
                case SlimeRepublics::Direction::Down:
                    position = Position(position.x, position.y - 1);
                    break;
                case SlimeRepublics::Direction::Left:
                    position = Position(position.x - 1, position.y);
                    break;
                case SlimeRepublics::Direction::Right:
                    position = Position(position.x + 1, position.y);
                    break;
                default:
                    break;
            }
        }
    };
} // namespace slime
