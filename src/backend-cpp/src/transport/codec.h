//
// Created by oliver on 9/6/26.
//

#ifndef BACKEND_CPP_ENCODING_H
#define BACKEND_CPP_ENCODING_H

#include "generated/common_generated.h"
#include "game/primitives.h"
#include "game/world.h"

class Codec {
public:
    [[nodiscard]] SlimeRepublics::Direction ToWire(Direction direction) const { return static_cast<SlimeRepublics::Direction>(direction); }
    [[nodiscard]] std::optional<Direction> FromWire(SlimeRepublics::Direction direction) const {
        if ((long)direction < 0 || (long)direction > (long)Direction::Right) { return std::nullopt; }
        return static_cast<Direction>(direction);
    }

    [[nodiscard]] std::string Encode(const GameManager &game_manager) const;
    [[nodiscard]] std::string Encode(const SlimeRepublics::PingEvent& pingEvent) const;
};

#endif //BACKEND_CPP_ENCODING_H
