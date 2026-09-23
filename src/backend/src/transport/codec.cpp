//
// Created by oliver on 9/6/26.
//

#include "codec.h"

template <typename ... Ts>
static std::string EncodeServerMessage(flatbuffers::FlatBufferBuilder& builder, flatbuffers::Offset<Ts>... offsets) {
    static_assert(sizeof...(Ts) > 0);
    static_assert(((SlimeRepublics::ServerEventTraits<Ts>::enum_value != SlimeRepublics::ServerEvent::NONE) && ...), "every offset must be a ServerEvent union member");

    const std::vector<SlimeRepublics::ServerEvent> types { SlimeRepublics::ServerEventTraits<Ts>::enum_value... };
    const std::vector<flatbuffers::Offset<void>> events { offsets.Union()... };

    const auto to = builder.CreateVector(types);
    const auto eo = builder.CreateVector(events);

    const auto mo = SlimeRepublics::CreateServerMessage(builder, to, eo);

    builder.Finish(mo, SlimeRepublics::ServerMessageIdentifier());

    return {
        std::string(reinterpret_cast<const char *>(builder.GetBufferPointer()),

                    builder.GetSize())
    };
}

std::string Codec::Encode(const GameManager &game_manager) const {
    flatbuffers::FlatBufferBuilder builder;

    std::vector<flatbuffers::Offset<SlimeRepublics::Slime> > v;

    for (auto &&[id, pose]: game_manager.GetSlimesWithPoses()) {
        const SlimeRepublics::Vec2 vec(pose.position.x, pose.position.y);
        const SlimeRepublics::Direction heading = ToWire(pose.heading);
        v.push_back(SlimeRepublics::CreateSlime(builder, (uint32_t)id, &vec, heading));
    }

    const auto svo = builder.CreateVector(v);
    const auto wso = SlimeRepublics::CreateWorldState(builder, svo);

    return EncodeServerMessage(builder, wso);
}

std::string Codec::Encode(const SlimeRepublics::PingEvent& pingEvent) const {
    flatbuffers::FlatBufferBuilder builder;

    const auto peo = SlimeRepublics::CreatePongEvent(builder, pingEvent.origin_time());

    return EncodeServerMessage(builder, peo);
}

