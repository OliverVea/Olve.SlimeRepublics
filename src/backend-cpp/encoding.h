//
// Created by oliver on 9/6/26.
//

#ifndef BACKEND_CPP_ENCODING_H
#define BACKEND_CPP_ENCODING_H
#include <flatbuffers/flatbuffer_builder.h>

#include "common_generated.h"
#include "world.h"

class Codec {
    flatbuffers::FlatBufferBuilder &_builder;

    template <typename ... Ts>
    std::string EncodeServerMessage(flatbuffers::Offset<Ts>... offsets);
public:
    std::string Encode(const slime::World &world);
    std::string Encode(const SlimeRepublics::PingEvent& pingEvent);
};



#endif //BACKEND_CPP_ENCODING_H
