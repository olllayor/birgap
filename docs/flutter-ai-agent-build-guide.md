# BirGap Flutter App — AI Agent Build Guide

This document contains everything an AI agent needs to build the Flutter client for BirGap, an E2EE 1:1 messenger.

---

## 1. Project Overview

BirGap is a **zero-knowledge encrypted messenger**. The server is an encrypted relay—it stores public keys and opaque ciphertext only. The Flutter app must handle all crypto locally.

### Key Constraints
- **No plaintext ever sent to server**
- **No private keys ever sent to server**
- **Max 3 active devices per user**
- **Signal Protocol compatible** (X3DH key exchange)
- **Per-device encryption envelopes** (one ciphertext per recipient device)

---

## 2. Recommended Architecture

### Feature-First Clean Architecture

```
lib/
├── core/
│   ├── constants/          # App-wide constants, routes
│   ├── errors/             # Failure classes, exceptions
│   ├── utils/              # Pure utilities (formatters, validators)
│   ├── theme/              # ThemeData, colors, typography
│   └── router/             # GoRouter configuration
│
├── data/
│   ├── datasources/
│   │   ├── remote/
│   │   │   ├── api_client.dart           # Dio instance + interceptors
│   │   │   ├── auth_remote_datasource.dart
│   │   │   ├── device_remote_datasource.dart
│   │   │   ├── message_remote_datasource.dart
│   │   │   ├── prekey_remote_datasource.dart
│   │   │   ├── user_remote_datasource.dart
│   │   │   ├── backup_remote_datasource.dart
│   │   │   └── realtime_datasource.dart  # Socket.IO manager
│   │   └── local/
│   │       ├── local_database.dart       # Isar/Drift instance
│   │       ├── message_local_datasource.dart
│   │       ├── session_local_datasource.dart  # Signal sessions
│   │       └── token_local_datasource.dart    # Secure storage
│   ├── repositories/       # Implement domain contracts
│   └── dto/                # API request/response models (fromJson/toJson)
│
├── domain/
│   ├── entities/
│   │   ├── user.dart
│   │   ├── device.dart
│   │   ├── message.dart
│   │   ├── envelope.dart
│   │   ├── thread.dart
│   │   └── prekey_bundle.dart
│   ├── repositories/       # Abstract contracts (abstract classes)
│   └── usecases/
│       ├── auth/
│       │   ├── request_otp.dart
│       │   ├── verify_otp.dart
│       │   └── logout.dart
│       ├── device/
│       │   ├── register_device.dart
│       │   ├── list_devices.dart
│       │   └── deactivate_device.dart
│       ├── message/
│       │   ├── send_message.dart
│       │   ├── fetch_pending_messages.dart
│       │   └── acknowledge_message.dart
│       ├── prekey/
│       │   ├── generate_keys.dart
│       │   ├── refill_prekeys.dart
│       │   ├── rotate_signed_prekey.dart
│       │   └── fetch_key_bundles.dart
│       └── realtime/
│           ├── connect_socket.dart
│           └── send_typing_event.dart
│
└── features/
    ├── auth/
    │   ├── presentation/
    │   │   ├── screens/
    │   │   │   ├── phone_input_screen.dart
    │   │   │   └── otp_verification_screen.dart
    │   │   └── widgets/
    │   └── providers/
    │       └── auth_provider.dart
    ├── chat/
    │   ├── presentation/
    │   │   ├── screens/
    │   │   │   ├── chat_list_screen.dart
    │   │   │   └── conversation_screen.dart
    │   │   └── widgets/
    │   │       ├── message_bubble.dart
    │   │       ├── message_input.dart
    │   │       └── typing_indicator.dart
    │   └── providers/
    │       ├── chat_provider.dart
    │       └── typing_provider.dart
    ├── contacts/
    │   ├── presentation/
    │   └── providers/
    ├── devices/
    │   ├── presentation/
    │   └── providers/
    ├── backup/
    │   ├── presentation/
    │   └── providers/
    └── settings/
        ├── presentation/
        └── providers/
```

---

## 3. Essential Packages

```yaml
dependencies:
  flutter_riverpod: ^2.6          # State management
  go_router: ^14.0                # Navigation
  dio: ^5.7                       # HTTP client
  socket_io_client: ^2.0          # WebSocket (Socket.IO)
  flutter_secure_storage: ^9.2    # Tokens, private keys (Keychain/Keystore)
  isar: ^3.1                      # Local database (or drift)
  isar_flutter_libs: ^3.1
  pointycastle: ^3.9              # Crypto (or flutter_sodium)
  encrypt: ^5.0                   # AES-GCM for backups
  uuid: ^4.5                      # UUID generation
  firebase_messaging: ^15.0       # Push notifications
  crypto: ^3.0                    # SHA-256 hashing
  shared_preferences: ^2.3        # Non-sensitive prefs
  connectivity_plus: ^6.1         # Network status
  flutter_local_notifications: ^18.0  # Local notifications

dev_dependencies:
  riverpod_generator: ^2.4
  build_runner: ^2.4
  isar_generator: ^3.1
  mockito: ^5.4
```

---

## 4. Base URL Configuration

```dart
class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );
}
```

Pass at build time: `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000`

---

## 5. Complete API Contract

### 5.1 Authentication

#### Request OTP
```
POST /auth/otp/request
Rate limit: 5/60s
Body: { "phone": "+998901234567" }
Response 202: { "phone": "+99890****67", "mode": "sayqal"|"mock", "success": true, "message": "...", "expiresInSeconds": 300 }
Cooldown 202: { "phone": "...", "mode": "...", "success": true, "message": "...", "canResendAt": "ISO-8601" }
```
- 2-minute cooldown per phone
- OTP is 6 digits, expires in 5 minutes
- In `mock` mode, code is logged to server console

#### Verify OTP
```
POST /auth/otp/verify
Rate limit: 5/60s
Body: { "phone": "+998901234567", "code": "482193" }
Response 200: { "user": { "id": "uuid" }, "accessToken": "jwt", "refreshToken": "opaque" }
Error 403: "Invalid OTP code" (attempt counted)
Error 403: "Too many failed attempts. Please try again later." (locked out)
Error 404: "Invalid or expired OTP"
```
- Max 5 failed attempts
- 15-minute lockout after max attempts
- Creates user if phone doesn't exist

#### Refresh Token
```
POST /auth/refresh
Body: { "refreshToken": "opaque" }
Response 200: { "user": { "id": "uuid" }, "accessToken": "jwt", "refreshToken": "new-opaque" }
```
- Old refresh token is revoked (rotation)
- If expired/revoked → 401

#### Logout
```
POST /auth/logout
Auth: Bearer token
Body (optional): { "refreshToken": "opaque" }
Response: 204 No Content
```

---

### 5.2 Devices

#### Register Device
```
POST /devices/register
Auth: Bearer token
Body: {
  "deviceId": "optional-existing-uuid",
  "platform": "IOS"|"ANDROID"|"WEB",
  "displayName": "My iPhone",
  "identityPublicKey": "base64-public-key",
  "pushToken": "optional-apns-token",
  "pushPlatform": "APNS"|"FCM"|"HMS",
  "pushActive": true
}
Response 201: { "id": "uuid", "platform": "IOS", "displayName": "...", "pushPlatform": "APNS", "pushActive": true, "lastSeenAt": "...", "createdAt": "..." }
Error 409: Max 3 active devices reached
```

#### List Devices
```
GET /devices
Auth: Bearer token
Response 200: [{ "id": "...", "platform": "...", "displayName": "...", ... }]
```

#### Deactivate Device
```
DELETE /devices/:deviceId
Auth: Bearer token
Response 200: { "id": "...", "active": false }
```

---

### 5.3 Prekeys

#### Get Prekey Count
```
GET /devices/:deviceId/prekeys/count
Auth: Bearer token
Response 200: { "deviceId": "...", "oneTimePrekeysRemaining": 45, "hasActiveSignedPrekey": true, "lowWatermark": false }
```
- `lowWatermark` is true when remaining < 10 → refill needed

#### Refill One-Time Prekeys
```
POST /devices/:deviceId/prekeys/refill
Auth: Bearer token
Body: { "prekeys": [{ "keyId": 101, "publicKey": "base64" }, ...] }
Response 200: { "inserted": 2 }
```
- Array length: 1-200
- `keyId`: integer > 0
- Duplicates skipped

#### Rotate Signed Prekey
```
PUT /devices/:deviceId/signed-prekey
Auth: Bearer token
Body: { "keyId": 10, "publicKey": "base64", "signature": "identity-key-signature" }
Response 200: { "id": "...", "deviceId": "...", "keyId": 10, "publicKey": "...", "signature": "...", "active": true, "createdAt": "..." }
```
- Deactivates previous signed prekeys
- Rotate every 7 days

---

### 5.4 Users / Key Bundles

#### Fetch Key Bundles
```
GET /users/:userId/devices/key-bundles
Auth: Bearer token
Response 200: {
  "userId": "...",
  "devices": [{
    "deviceId": "...",
    "userId": "...",
    "platform": "...",
    "identityPublicKey": "base64",
    "signedPrekey": { "id": "...", "keyId": 10, "publicKey": "...", "signature": "...", "createdAt": "..." },
    "oneTimePrekey": { "keyId": 101, "publicKey": "..." } | null
  }]
}
```
- **Consumes** one one-time prekey per device
- `oneTimePrekey` may be `null` → must support session init without it

---

### 5.5 Messages

#### Send Message
```
POST /messages
Auth: Bearer token
Body: {
  "senderDeviceId": "uuid",
  "recipientUserId": "uuid",
  "idempotencyKey": "client-generated-unique-8-to-128-chars",
  "envelopes": [{
    "recipientDeviceId": "uuid",
    "ciphertext": {
      "type": "signal-message",
      "body": "base64-ciphertext",
      "metadata": { "clientMessageId": "local-id" }
    }
  }]
}
Response 200: {
  "id": "message-uuid",
  "threadId": "thread-uuid",
  "senderUserId": "...",
  "senderDeviceId": "...",
  "threadSequence": 1,
  "createdAt": "...",
  "envelopes": [...]
}
```
- `idempotencyKey` required, 8-128 chars
- Unique constraint: `(senderDeviceId, idempotencyKey)`
- Must include envelope for **every active recipient device**
- May include sender's other devices for sync
- Retrying same idempotency key returns original message

#### Fetch Pending Messages
```
GET /messages/pending?deviceId=uuid&after=cursor&limit=50
Auth: Bearer token
Response 200: {
  "deviceId": "...",
  "hasMore": true|false,
  "envelopes": [{
    "id": "...",
    "messageId": "...",
    "recipientUserId": "...",
    "recipientDeviceId": "...",
    "ciphertext": { "type": "signal-message", "body": "base64" },
    "status": "PENDING"|"DELIVERED",
    "deliveredAt": null|"...",
    "readAt": null|"...",
    "envelopeSequence": "142",
    "createdAt": "...",
    "message": {
      "id": "...",
      "threadId": "...",
      "senderUserId": "...",
      "senderDeviceId": "...",
      "threadSequence": 1,
      "createdAt": "..."
    }
  }]
}
```
- Pagination: use `envelopeSequence` as `after` cursor
- Loop until `hasMore` is false
- Call after: login, WebSocket reconnect, push wakeup

#### Acknowledge Message
```
POST /messages/:messageId/ack
Auth: Bearer token
Body: { "deviceId": "uuid", "status": "DELIVERED"|"READ" }
Response 200: { "id": "...", "messageId": "...", "status": "DELIVERED", "deliveredAt": "...", "readAt": null, "createdAt": "..." }
```
- `READ` also sets `deliveredAt`
- Sender receives `message.ack` WebSocket event

---

### 5.6 Realtime

#### Create WebSocket Ticket
```
POST /realtime/token
Auth: Bearer token
Body: { "deviceId": "uuid" }
Response 200: { "ticket": "single-use-ticket", "expiresAt": "ISO-8601" }
```
- TTL: 60 seconds
- Single-use only

#### Socket.IO Connection
```dart
import 'package:socket_io_client/socket_io_client.dart' as io;

final socket = io.io(
  ApiConfig.baseUrl,
  io.OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'ticket': ticket})
    .build(),
);
```
- Server ping interval: 25 seconds

---

### 5.7 Backups

#### Get Upload URL
```
POST /backups/upload-url
Auth: Bearer token
Body: { "sizeBytes": 12345 }
Response 200: { "uploadUrl": "presigned-r2-url", "bucketKey": "backups/user-uuid/backup-uuid.bin", "method": "PUT" }
```
- Upload directly to R2 (not through API)
- URL TTL: 900 seconds

#### Upload Current Backup
```
PUT /backups/current
Auth: Bearer token
Body: { "version": 1, "bucketKey": "...", "sha256": "...", "sizeBytes": 12345 }
Response 200: { "id": "...", "version": 1, "sha256": "...", "sizeBytes": 12345, "uploadedAt": "..." }
```

#### Download Current Backup
```
GET /backups/current
Auth: Bearer token
Response 200: { "downloadUrl": "presigned-r2-url", "sha256": "...", "sizeBytes": 12345, "version": 1, "uploadedAt": "..." }
```
- Download directly from R2
- Verify SHA-256 after download

#### Get Backup Metadata
```
GET /backups/metadata
Auth: Bearer token
Response 200: { "sha256": "...", "sizeBytes": 12345, "version": 1, "uploadedAt": "..." }
```

---

### 5.8 Health
```
GET /health
No auth required
Response 200: { "status": "ok", "info": { "postgres": { "status": "up" }, "redis": { "status": "up" } } }
```

---

## 6. WebSocket Events

### Server → Client

| Event | Payload | Action |
|-------|---------|--------|
| `message.new` | Envelope object | Decrypt, store locally, ACK DELIVERED |
| `message.ack` | `{ messageId, deviceId, userId, status, threadId, threadSequence, senderUserId, senderDeviceId }` | Update UI delivery status |
| `typing.start` | `{ userId, deviceId }` | Show typing indicator (auto-expire after 3s) |
| `typing.stop` | `{ userId, deviceId }` | Hide typing indicator |
| `presence.active` | `{ userId, deviceId }` | Show user as online |

### Client → Server

| Event | Payload | When |
|-------|---------|------|
| `typing.start` | `{ "recipientUserId": "uuid" }` | User starts typing in text field |
| `typing.stop` | `{ "recipientUserId": "uuid" }` | User stops typing / sends message |

---

## 7. Error Codes

| Code | Meaning | Client Action |
|------|---------|---------------|
| 400 | Bad request | Fix parameters |
| 401 | Token expired/invalid | Refresh token once, retry |
| 403 | Device/session revoked | Stop using this device |
| 403 | OTP too many attempts | Wait 15 minutes |
| 404 | Not found | Resource doesn't exist |
| 409 | Max devices reached | Show device removal UI |
| 429 | Rate limited | Wait and retry |

---

## 8. Security Model

### What Server Knows
- Phone number hashes (not plaintext)
- Device metadata
- Public keys only
- Message metadata (thread ID, sequence, timestamps)
- Opaque ciphertext blobs

### What Server Cannot Access
- Message content
- Private keys
- Signal session state
- Backup content

### Token Architecture
| Token | Type | TTL | Storage |
|-------|------|-----|---------|
| Access Token | JWT | 15 min | Memory (not persistent) |
| Refresh Token | Opaque | 30 days | Secure storage (Keychain/Keystore) |
| Socket Ticket | Single-use | 60 sec | Memory only |

---

## 9. Crypto Requirements

### Key Generation (per device)
```dart
// 1. Identity Key Pair (long-term, stays with device)
//    - X25519 curve
//    - Signs all SignedPreKeys

// 2. Signed PreKey (medium-term, rotate every 7 days)
//    - X25519 curve
//    - Signed by Identity Key

// 3. One-Time PreKeys (pool of 100+)
//    - X25519 curve
//    - Consumed one at a time
//    - Refill when count < 10
```

### Session Establishment (X3DH)
```
For each recipient device:
1. Fetch key bundle (identity key + signed prekey + optional one-time prekey)
2. Perform X3DH key agreement locally
3. Derive session keys
4. Encrypt message
5. Create ciphertext envelope
```

### Encryption Flow (Send Message)
```
1. Fetch recipient key bundles: GET /users/:userId/devices/key-bundles
2. For each recipient device:
   a. Initialize/reuse Signal session
   b. Encrypt message with session keys
   c. Create envelope: { recipientDeviceId, ciphertext }
3. Add sender-sync envelopes for own other devices (optional)
4. Generate idempotencyKey (UUID)
5. POST /messages
6. Store locally with returned threadSequence
```

### Decryption Flow (Receive Message)
```
1. Receive envelope via WebSocket or pending sync
2. Find Signal session for sender device
3. Decrypt ciphertext
4. Store message locally
5. ACK DELIVERED: POST /messages/:messageId/ack
6. When user opens chat → ACK READ
```

### Recommended Crypto Library
- **`flutter_sodium`** — libsodium bindings (recommended, closest to Signal)
- **`pointycastle`** — pure Dart crypto (X25519, AES-GCM available)
- Consider **`libsignal_client`** if Dart bindings exist

---

## 10. State Management (Riverpod)

### Core Providers
```dart
// Auth state
final authProvider = StateNotifierProvider<AuthNotifier, AuthState>(...);

// WebSocket connection
final socketProvider = StateNotifierProvider<SocketNotifier, SocketState>(...);

// Current device
final deviceProvider = StateProvider<Device?>((ref) => null);

// Per-thread messages (auto-dispose when not in use)
final threadMessagesProvider = AutoDisposeFutureProviderFamily<List<Message>, String>((ref, threadId) async {
  // Fetch from local DB
});

// Typing indicators
final typingProvider = StateNotifierProvider<TypingNotifier, Map<String, bool>>(...);

// Presence
final presenceProvider = StateNotifierProvider<PresenceNotifier, Set<String>>(...);
```

---

## 11. Local Database Schema (Isar)

```dart
@collection
class LocalMessage {
  Id id;
  String messageId;
  String threadId;
  String senderUserId;
  String senderDeviceId;
  int threadSequence;
  String decryptedBody; // JSON of decrypted content
  DateTime createdAt;
  bool isDelivered;
  bool isRead;
}

@collection
class LocalThread {
  Id id;
  String threadId;
  String peerUserId;
  int latestSequence;
  String? lastMessagePreview;
  DateTime? lastMessageAt;
  int unreadCount;
}

@collection
class LocalSession {
  Id id;
  String senderDeviceId;
  String recipientDeviceId;
  String sessionData; // Serialized Signal session
  DateTime createdAt;
  DateTime updatedAt;
}

@collection
class LocalDevice {
  Id id;
  String deviceId;
  String userId;
  String platform;
  String identityPublicKey;
  bool isActive;
}
```

---

## 12. Critical Service Implementations

### 12.1 Token Manager
```dart
class TokenManager {
  final FlutterSecureStorage _storage;

  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    await _storage.write(key: 'access_token', value: accessToken);
    await _storage.write(key: 'refresh_token', value: refreshToken);
  }

  Future<String?> getAccessToken() => _storage.read(key: 'access_token');
  Future<String?> getRefreshToken() => _storage.read(key: 'refresh_token');
  Future<void> clearTokens() async {
    await _storage.delete(key: 'access_token');
    await _storage.delete(key: 'refresh_token');
  }
}
```

### 12.2 Dio Interceptor (Auth + Refresh)
```dart
class AuthInterceptor extends Interceptor {
  final TokenManager tokenManager;
  final AuthService authService;
  bool _isRefreshing = false;
  final _queue = <RequestOptions>[];

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await tokenManager.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401 && !_isRefreshing) {
      _isRefreshing = true;
      try {
        final refreshToken = await tokenManager.getRefreshToken();
        if (refreshToken != null) {
          final newTokens = await authService.refresh(refreshToken);
          await tokenManager.saveTokens(
            accessToken: newTokens.accessToken,
            refreshToken: newTokens.refreshToken,
          );
          // Retry queued requests
          for (final req in _queue) {
            req.headers['Authorization'] = 'Bearer ${newTokens.accessToken}';
            dio.fetch(req);
          }
          _queue.clear();
          // Retry original
          err.requestOptions.headers['Authorization'] = 'Bearer ${newTokens.accessToken}';
          handler.resolve(await dio.fetch(err.requestOptions));
        }
      } finally {
        _isRefreshing = false;
      }
    } else if (err.response?.statusCode == 401) {
      _queue.add(err.requestOptions);
    } else {
      handler.next(err);
    }
  }
}
```

### 12.3 WebSocket Manager
```dart
class WebSocketManager {
  io.Socket? _socket;
  final ApiClient _apiClient;
  final String _deviceId;

  Future<void> connect() async {
    // 1. Get ticket
    final ticket = await _apiClient.getSocketTicket(_deviceId);

    // 2. Connect
    _socket = io.io(
      ApiConfig.baseUrl,
      io.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth({'ticket': ticket})
        .build(),
    );

    // 3. Listen to events
    _socket!.on('message.new', _handleNewMessage);
    _socket!.on('message.ack', _handleMessageAck);
    _socket!.on('typing.start', _handleTypingStart);
    _socket!.on('typing.stop', _handleTypingStop);
    _socket!.on('presence.active', _handlePresence);

    // 4. Handle disconnect → reconnect with new ticket
    _socket!.onDisconnect((_) => _reconnect());
  }

  Future<void> _reconnect() async {
    await Future.delayed(const Duration(seconds: 2));
    await connect();
    // After reconnect: fetch pending messages
    await _syncPendingMessages();
  }

  void sendTypingStart(String recipientUserId) {
    _socket?.emit('typing.start', {'recipientUserId': recipientUserId});
  }

  void sendTypingStop(String recipientUserId) {
    _socket?.emit('typing.stop', {'recipientUserId': recipientUserId});
  }
}
```

### 12.4 Message Sync Service
```dart
class MessageSyncService {
  final MessageRemoteDatasource remote;
  final MessageLocalDatasource local;
  final CryptoService crypto;
  final String deviceId;

  Future<void> syncPendingMessages() async {
    String? after;
    do {
      final response = await remote.fetchPendingMessages(
        deviceId: deviceId,
        after: after,
        limit: 50,
      );

      for (final envelope in response.envelopes) {
        // Decrypt
        final decrypted = await crypto.decryptEnvelope(envelope);

        // Store locally
        await local.saveMessage(decrypted);

        // ACK delivered
        await remote.acknowledgeMessage(
          messageId: envelope.messageId,
          deviceId: deviceId,
          status: 'DELIVERED',
        );
      }

      after = response.hasMore
          ? response.envelopes.last.envelopeSequence
          : null;
    } while (after != null);
  }
}
```

---

## 13. App Startup Sequence

```
1. Check for existing session (refresh token in secure storage)
2. If no session → show Phone Input Screen
3. If session exists → refresh access token
4. Register device (or reactivate)
   POST /devices/register
5. Check prekey count
   GET /devices/:id/prekeys/count
6. If no signed prekey → generate + upload
   PUT /devices/:id/signed-prekey
7. If prekeys low (<10) or zero → generate + refill
   POST /devices/:id/prekeys/refill
8. Get WebSocket ticket
   POST /realtime/token
9. Connect Socket.IO
10. Fetch pending messages
    GET /messages/pending?deviceId=...
11. Decrypt + store + ACK each envelope
12. Navigate to Chat List
```

---

## 14. Send Message Sequence

```
1. User types message in ConversationScreen
2. Check if session exists with recipient's devices
3. If no session → fetch key bundles
   GET /users/:recipientId/devices/key-bundles
4. For each recipient device:
   a. Initialize Signal session (X3DH)
   b. Encrypt message
   c. Create envelope
5. Add sender-sync envelopes for own other devices (optional)
6. Generate idempotencyKey (UUID v4)
7. Show optimistic message in UI
8. POST /messages
9. On success: reconcile with server response (id, threadSequence)
10. On failure: show retry option (reuse same idempotencyKey)
```

---

## 15. Push Notification Handling

```dart
// When push received (silent notification)
FirebaseMessaging.onMessage.listen((message) {
  if (message.data['type'] == 'new_message') {
    // Fetch pending messages
    messageSyncService.syncPendingMessages();
  }
});

// When app opened from push
FirebaseMessaging.onMessageOpenedApp.listen((message) {
  // Navigate to conversation
});
```

Push payload contains **no message content**:
```json
{ "data": { "type": "new_message" } }
```

---

## 16. Typing Indicator Logic

```dart
// Debounce typing events
class TypingNotifier extends StateNotifier<Map<String, bool>> {
  Timer? _debounce;

  void onTyping(String userId) {
    state = {...state, userId: true};
    _debounce?.cancel();
    _debounce = Timer(const Duration(seconds: 3), () {
      state = {...state, userId: false};
    });
  }
}

// In text field
TextField(
  onChanged: (text) {
    if (text.isNotEmpty && !_wasTyping) {
      socketManager.sendTypingStart(recipientUserId);
      _wasTyping = true;
    } else if (text.isEmpty && _wasTyping) {
      socketManager.sendTypingStop(recipientUserId);
      _wasTyping = false;
    }
  },
)
```

---

## 17. Error Handling Patterns

```dart
// API error wrapper
class ApiFailure {
  final int statusCode;
  final String message;

  bool get isTokenExpired => statusCode == 401;
  bool get isDeviceRevoked => statusCode == 403;
  bool get isMaxDevices => statusCode == 409;
  bool get isRateLimited => statusCode == 429;
}

// Use case error handling
class SendMessage {
  Future<Either<ApiFailure, Message>> call(...) async {
    try {
      final result = await repo.sendMessage(...);
      return Right(result);
    } on DioException catch (e) {
      return Left(ApiFailure(
        statusCode: e.response?.statusCode ?? 500,
        message: e.response?.data['message'] ?? 'Unknown error',
      ));
    }
  }
}
```

---

## 18. UI Screens List

| Screen | Purpose | Route |
|--------|---------|-------|
| PhoneInputScreen | Enter phone number | `/auth/phone` |
| OtpVerificationScreen | Enter 6-digit code | `/auth/otp` |
| ChatListScreen | List of conversations | `/chats` |
| ConversationScreen | 1:1 chat with messages | `/chats/:userId` |
| DeviceManagementScreen | List/remove devices | `/settings/devices` |
| BackupScreen | Backup/restore chat state | `/settings/backup` |
| SettingsScreen | App settings | `/settings` |
| SafetyNumberScreen | Verify identity keys | `/chats/:userId/safety` |

---

## 19. Platform-Specific Setup

### iOS (Info.plist)
```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsArbitraryLoads</key>
  <true/> <!-- Only for dev -->
</dict>
<key>UIBackgroundModes</key>
<array>
  <string>fetch</string>
  <string>remote-notification</string>
</array>
```

### Android (AndroidManifest.xml)
```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
```

---

## 20. Testing Strategy

```
test/
├── unit/
│   ├── crypto_service_test.dart
│   ├── token_manager_test.dart
│   └── usecases/
│       ├── verify_otp_test.dart
│       └── send_message_test.dart
├── integration/
│   ├── auth_flow_test.dart
│   └── message_flow_test.dart
└── widget/
    ├── phone_input_screen_test.dart
    └── conversation_screen_test.dart
```

---

## 21. Build Commands

```bash
# Development
flutter run

# Development with API override
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000

# Release build
flutter build apk --release   # Android
flutter build ios --release   # iOS
```

---

## 22. Environment Variables

```bash
# Pass at build/run time
--dart-define=API_BASE_URL=https://api.birgap.com
--dart-define=SENTRY_DSN=...
--dart-define=FLAVOR=production
```

Access in code:
```dart
const apiBaseUrl = String.fromEnvironment('API_BASE_URL');
```

---

## 23. Key Implementation Notes

1. **Idempotency is critical**: Always generate and store `idempotencyKey` before sending. Reuse on retry.
2. **Thread sequence > envelope sequence**: Use `threadSequence` for UI ordering. `envelopeSequence` is only for pagination.
3. **Support `oneTimePrekey: null`**: Session must work without one-time prekey.
4. **Pending sync after reconnect**: Always call `GET /messages/pending` after WebSocket reconnect.
5. **Secure storage for keys**: Private keys go in Keychain (iOS) / Keystore (Android), never in SharedPreferences.
6. **Auto-expire typing**: 3 seconds client-side if no new event arrives.
7. **Refresh token rotation**: Old token revoked on use. Store new one immediately.
8. **Max 3 devices**: Show device management UI when limit reached.
