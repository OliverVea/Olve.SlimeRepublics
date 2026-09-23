//
// Created by oliver on 9/7/26.
//

#ifndef BACKEND_CPP_ENTITIES_H
#define BACKEND_CPP_ENTITIES_H

#include <entt/entt.hpp>
#include <spdlog/spdlog.h>

#include "primitives.h"

struct Movable {
    float speed = 1.0f;
    float time_until = 0.0f;
};

struct Networked {
    SlimeId id;
};


class EntitySystem {
    entt::registry& registry_;
    std::unordered_map<SlimeId, entt::entity> entities_;

public:
    EntitySystem(entt::registry& registry) : registry_(registry) {  }

    entt::registry& registry() const { return registry_;}

    std::optional<entt::entity> GetEntity(SlimeId slimeId) {
        if (!entities_.contains(slimeId)) {
            spdlog::error("Failed to get entity with id {}", slimeId);
            return std::nullopt;
        }

        return entities_[slimeId];
    }

    void CreateSlime(const SlimeId slimeId) {
        const entt::entity entity = registry_.create();
        registry_.emplace<Networked>(entity, slimeId);
        registry_.emplace<Pose>(entity);
        entities_[slimeId] = entity;
    }

    bool DestroySlime(const SlimeId slimeId) {
        const std::optional<entt::entity> entity = GetEntity(slimeId);
        if (!entity.has_value()) return false;
        registry_.destroy(entity.value());
        entities_.erase(slimeId);
        return true;
    }
};

#endif //BACKEND_CPP_ENTITIES_H
