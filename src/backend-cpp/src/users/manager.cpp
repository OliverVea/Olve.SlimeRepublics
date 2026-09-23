//
// Created by oliver on 9/7/26.
//

#include <sodium.h>
#include "manager.h"

#include <spdlog/spdlog.h>

constexpr int sodium_success = 0;

UserManager::UserManager(UserRepository &repository): repository_(repository) {
    ops_limit_ = crypto_pwhash_OPSLIMIT_INTERACTIVE;
    mem_limit_ = crypto_pwhash_MEMLIMIT_INTERACTIVE;
}

void UserManager::Initialize() {
    if (initialized_) return;

    if (sodium_init() != sodium_success) {
        spdlog::error("Failed to initialize sodium");
        return;
    }

    char password_hash_buffer[crypto_pwhash_STRBYTES] {0};
    if (crypto_pwhash_str(password_hash_buffer, dummy_password_.c_str(), dummy_password_.size(), ops_limit_, mem_limit_) != sodium_success) {
        throw std::runtime_error("Failed to initialize dummy password");
    }
    dummy_password_hash_ = std::string(password_hash_buffer);
    initialized_ = true;

    spdlog::info("Initialized sodium successfully");
}

std::expected<UserId, UserCreationError> UserManager::CreateUser(const std::string& email, const std::string& display_name, const std::string& password, bool test_account) const {
    char password_hash_buffer[crypto_pwhash_STRBYTES] {0};
    if (crypto_pwhash_str(password_hash_buffer, password.c_str(), password.size(), ops_limit_, mem_limit_) != sodium_success) {
        spdlog::error("Failed to hash password with length {}", password.size());
        return std::unexpected(UserCreationError::InvalidPassword);
    }
    const auto password_hash = std::string(password_hash_buffer);
    return repository_.CreateUser(email, display_name, password_hash, test_account);
}

std::optional<User> UserManager::CheckUserLogin(const std::string& email, const std::string& password) const {
    const auto user_id =  repository_.GetUserIdByEmail(email);
    if (!user_id.has_value()) {
        auto _ = crypto_pwhash_str_verify(dummy_password_hash_.c_str(), password.c_str(), password.size());
        return std::nullopt;
    }

    const auto user = repository_.GetUser(user_id.value());
    if (!user.has_value()) {
        auto _ = crypto_pwhash_str_verify(dummy_password_hash_.c_str(), password.c_str(), password.size());
        return std::nullopt;
    }

    const auto password_hash = user.value().pw_hash;
    const auto match = crypto_pwhash_str_verify(password_hash.c_str(), password.c_str(), password.size());

    return match == 0 ? user : std::nullopt;
}
