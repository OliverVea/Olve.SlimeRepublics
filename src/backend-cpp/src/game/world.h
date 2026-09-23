#pragma once

#include <ranges>
#include <utility>
#include <entt/entt.hpp>
#include "primitives.h"
#include "events.h"
#include "entities.h"

class GameManager {
    float t_ = 0;

    EntitySystem &entities_;
    EventQueue &events_;

public:
    GameManager(EntitySystem &entity_system, EventQueue &event_queue) : entities_(entity_system), events_(event_queue) {
    }

    void Tick(const float dt) {
        t_ += dt;
        DrainEvents();
    }

    void DrainEvents() const {
        while (!events_.empty()) {
            Event e = events_.front();
            events_.pop();

            std::visit(entt::overloaded{
                           [&](const Spawn &cmd) { entities_.CreateSlime(cmd.id); },
                           [&](const Despawn &cmd) { entities_.DestroySlime(cmd.id); },
                           [&](const Move &cmd) { MoveSlime(cmd.id, cmd.direction); },
                           [&](const Interact &cmd) { SlimeInteract(cmd.id); },

                       }, e);
        }
    }

    [[nodiscard]] auto GetSlimesWithPoses() const {
        return entities_.registry().view<const Networked, const Pose>().each()
               | std::views::transform([](auto &&t) { return std::pair{std::get<1>(t).id, std::get<2>(t)}; });
    }

    void MoveSlime(const SlimeId slimeId, const Direction direction) const {
        const auto entity = entities_.GetEntity(slimeId);
        if (!entity.has_value()) { return; }

        auto &&[pose] = entities_.registry().view<Pose>().get(entity.value());

        const Vec2i delta = to_vector(direction);
        pose.position += delta;
        pose.heading = direction;
    }

    void SlimeInteract(const SlimeId slimeId) const {
        const auto entity = entities_.GetEntity(slimeId);
        if (!entity.has_value()) { return; }

        auto &&[pose] = entities_.registry().view<const Pose>().get(entity.value());

        spdlog::info("Slime {} interacts {}", slimeId, pose.heading);
    }
};
