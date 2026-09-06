//
// Created by oliver on 9/6/26.
//

#ifndef BACKEND_CPP_ENCODING_H
#define BACKEND_CPP_ENCODING_H
#include <flatbuffers/flatbuffer_builder.h>

#include "common_generated.h"
#include "world.h"

class Codec {
public:
    [[nodiscard]] std::string Encode(const GameManager &game_manager) const;
    [[nodiscard]] std::string Encode(const SlimeRepublics::PingEvent& pingEvent) const;
};

#endif //BACKEND_CPP_ENCODING_H
