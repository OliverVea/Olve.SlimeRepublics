#pragma once

#include <cmath>
#include <print>
#include <ranges>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <entt/entt.hpp>

#include "primitives.h"


// ---------------------------------------------------------------- components

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

class GameManager {
private:
    std::unordered_map<SlimeId, entt::entity> entities_;

    float t_ = 0;
    SlimeId _next = 1;

    entt::registry registry_;
    Events events_;

    std::vector<Spawn> spawns_;
    std::vector<Despawn> despawns_;

public:
    void Enqueue(const Spawn cmd) { spawns_.push_back(cmd); }
    void Enqueue(const Despawn cmd) { despawns_.push_back(cmd); }

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

    SlimeId GetNextSlimeId() {
        return _next++;
    }

    auto GetSlimesWithPoses() const {
        return registry_.view<const Networked, const Pose>().each()
               | std::views::transform([](auto &&t) { return std::pair{std::get<1>(t).id, std::get<2>(t)}; });
    }

    void ApplyCommands() {
        for (const Spawn &cmd: spawns_) {
            const entt::entity entity = registry_.create();
            registry_.emplace<Networked>(entity, cmd.id);
            registry_.emplace<Pose>(entity, Pose());
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

    void MoveSlime(SlimeId slimeId, Direction direction) {
        if (!entities_.contains(slimeId)) {
            std::println("Failed to get entity with id {}", slimeId);
            return;
        }

        const auto entity = entities_[slimeId];
        auto&& [pose] = registry_.view<Pose>().get(entity);

        const Vec2i delta = to_vector(direction);
        pose.position += delta;
        pose.heading = direction;
    }

    void SlimeInteract(SlimeId slimeId) {
        if (!entities_.contains(slimeId)) {
            std::println("Failed to get entity with id {}", slimeId);
            return;
        }

        const auto entity = entities_[slimeId];
        auto&& [pose] = registry_.view<const Pose>().get(entity);

        std::println("Slime {} interacts {}", slimeId, pose.heading);
    }
};
