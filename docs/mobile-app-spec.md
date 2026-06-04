# BirGap Flutter Mobile App — Full Build Spec

This document is the single source of truth for an AI coding agent to build the BirGap Flutter client. Every endpoint, model, provider, and flow is specified below.

---

## 1. Tech Stack

| Concern | Package | Version |
|---------|---------|---------|
| Framework | Flutter | >=3.24 |
| State management | `flutter_riverpod` | ^2.6 |
| Code generation | `riverpod_annotation`, `riverpod_generator`, `build_runner` | latest |
| HTTP client | `dio` | ^5.7 |
| Socket.IO | `socket_io_client` | ^3.0 |
| Local DB | `drift` (SQLite) | ^2.22 |
| Secure storage | `flutter_secure_storage` | ^9.2 |
| Routing | `go_router` | ^14.6 |
| Push (FCM) | `firebase_messaging` | ^15.2 |
| Firebase core | `firebase_core` | ^3.12 |
| Signal Protocol | `libsignal_protocol_dart` | ^0.8 |
| JSON serialization | `freezed` + `json_serializable` | latest |
| UUID generation | `uuid` | ^4.5 |
| Crypto (Dart) | `crypto` (built-in) | — |
| Background fetch | `workmanager` | ^0.5 |
| Permission handler | `permission_handler` | ^11.3 |
| Intl (dates) | `intl` | ^0.19 |

---

## 2. Project Structure

```
birgap_app/
├── android/
├── ios/
├── lib/
│   ├── main.dart                             # runApp with ProviderScope
│   ├── app.dart                              # MaterialApp.router setup
│   │
│   ├── core/
│   │   ├── api/
│   │   │   ├── api_client.dart               # Dio + interceptors
│   │   │   ├── api_endpoints.dart            # All URL constants
│   │   │   ├── auth_api.dart                 # POST /auth/*
│   │   │   ├── device_api.dart               # POST/GET/DELETE /devices/*
│   │   │   ├── prekey_api.dart               # POST/GET/PUT /devices/:id/prekeys/*
│   │   │   ├── user_api.dart                 # GET /users/:id/devices/key-bundles
│   │   │   ├── message_api.dart              # POST /messages, GET /messages/pending, POST /messages/:id/ack
│   │   │   ├── media_api.dart                # POST /messages/media/init, /complete, GET /messages/media/:id/download-url
│   │   │   ├── backup_api.dart               # POST /backups/*
│   │   │   └── realtime_api.dart             # POST /realtime/token
│   │   │
│   │   ├── socket/
│   │   │   ├── socket_manager.dart           # Socket.IO lifecycle + event streams
│   │   │   └── socket_events.dart            # Event name constants + typed payloads
│   │   │
│   │   ├── crypto/
│   │   │   ├── identity_key_store.dart       # Persist/load identity keys from secure storage
│   │   │   ├── prekey_store.dart             # Generate/refill/rotate prekeys
│   │   │   ├── session_store.dart            # Manage Signal sessions per (userId, deviceId)
│   │   │   ├── message_encryptor.dart        # Encrypt outgoing message payloads
│   │   │   └── message_decryptor.dart        # Decrypt incoming envelope ciphertext
│   │   │
│   │   ├── storage/
│   │   │   ├── secure_storage_manager.dart   # flutter_secure_storage wrapper
│   │   │   └── local_database.dart           # Drift DB definition
│   │   │
│   │   ├── push/
│   │   │   └── push_service.dart             # FCM init, token registration, background handler
│   │   │
│   │   └── config/
│   │       └── app_config.dart               # Base URL, timeouts, constants
│   │
│   ├── features/
│   │   ├── auth/
│   │   │   ├── models/
│   │   │   │   ├── auth_state.dart           # freezed: unauthenticated | otpSent | verified | loggedIn
│   │   │   │   └── token_pair.dart           # accessToken + refreshToken
│   │   │   ├── providers/
│   │   │   │   └── auth_provider.dart        # AuthNotifier: login/logout/refresh
│   │   │   └── screens/
│   │   │       ├── phone_input_screen.dart   # Phone number input
│   │   │       └── otp_verify_screen.dart    # OTP code input
│   │   │
│   │   ├── chat/
│   │   │   ├── models/
│   │   │   │   ├── thread_model.dart         # freezed: id, userAId, userBId, lastMessage, unreadCount
│   │   │   │   ├── message_model.dart        # freezed: id, threadId, senderUserId, content, status, timestamp
│   │   │   │   └── pending_envelope.dart     # Raw envelope from server (before decryption)
│   │   │   ├── providers/
│   │   │   │   ├── chat_list_provider.dart   # Stream of threads from local DB
│   │   │   │   ├── message_list_provider.dart# Paginated messages for a thread
│   │   │   │   ├── send_message_provider.dart# Send flow: fetch bundles → encrypt → POST
│   │   │   │   ├── pending_poller.dart       # Poll GET /messages/pending after WS event
│   │   │   │   └── typing_provider.dart      # Typing indicator state
│   │   │   └── screens/
│   │   │       ├── chat_list_screen.dart
│   │   │       └── chat_screen.dart
│   │   │
│   │   ├── contacts/
│   │   │   ├── models/
│   │   │   │   └── contact_model.dart
│   │   │   └── screens/
│   │   │       └── contact_picker_screen.dart
│   │   │
│   │   ├── devices/
│   │   │   ├── models/
│   │   │   │   └── device_model.dart
│   │   │   └── screens/
│   │   │       └── device_settings_screen.dart
│   │   │
│   │   └── settings/
│   │       ├── providers/
│   │       │   └── backup_provider.dart
│   │       └── screens/
│   │           └── settings_screen.dart
│   │
│   └── shared/
│       ├── models/
│       │   ├── user_model.dart               # freezed: id, phoneMasked
│       │   ├── device_model.dart             # freezed: id, platform, displayName, etc.
│       │   └── envelope_status.dart          # enum: pending, delivered, read
│       ├── widgets/
│       │   ├── user_avatar.dart
│       │   ├── loading_indicator.dart
│       │   ├── error_banner.dart
│       │   └── message_bubble.dart
│       └── extensions/
│           ├── date_extensions.dart
│           └── string_extensions.dart
│
├── pubspec.yaml
├── analysis_options.yaml
└── .env                                    # API_BASE_URL, FCM_*
```

---

## 3. Data Models (Freezed)

### `auth_state.dart`

```dart
@freezed
class AuthState with _$AuthState {
  const factory AuthState.unauthenticated() = _Unauthenticated;
  const factory AuthState.otpSent({required String phone, required int expiresInSeconds, DateTime? canResendAt}) = _OtpSent;
  const factory AuthState.verified({required String userId, required String accessToken, required String refreshToken}) = _Verified;
  const factory AuthState.authenticated({required String userId, required String accessToken, required String refreshToken, required String deviceId}) = _Authenticated;
  const factory AuthState.error({required String message}) = _AuthError;
}
```

### `token_pair.dart`

```dart
@freezed
class TokenPair with _$TokenPair {
  const factory TokenPair({
    required String accessToken,
    required String refreshToken,
    required String userId,
  }) = _TokenPair;

  factory TokenPair.fromJson(Map<String, dynamic> json) => _$TokenPairFromJson(json);
}
```

### `thread_model.dart`

```dart
@freezed
class Thread with _$Thread {
  const factory Thread({
    required String id,
    required String otherUserId,
    required String? otherUserName,
    required String? lastMessagePreview,
    required int? lastMessageSequence,
    required DateTime? lastMessageAt,
    required int unreadCount,
  }) = _Thread;

  factory Thread.fromJson(Map<String, dynamic> json) => _$ThreadFromJson(json);
}
```

### `message_model.dart`

```dart
@freezed
class Message with _$Message {
  const factory Message({
    required String id,
    required String threadId,
    required String senderUserId,
    required String senderDeviceId,
    required int threadSequence,
    required String? text,
    required MessageStatus status,
    required DateTime createdAt,
    DateTime? deliveredAt,
    DateTime? readAt,
  }) = _Message;

  factory Message.fromJson(Map<String, dynamic> json) => _$MessageFromJson(json);
}

enum MessageStatus { sending, pending, delivered, read, failed }
```

### `pending_envelope.dart`

```dart
@freezed
class PendingEnvelope with _$PendingEnvelope {
  const factory PendingEnvelope({
    required String id,
    required String messageId,
    required String recipientUserId,
    required String recipientDeviceId,
    required Map<String, dynamic> ciphertext,
    required String status,
    required String envelopeSequence,
    required DateTime createdAt,
    required PendingEnvelopeMessage message,
  }) = _PendingEnvelope;

  factory PendingEnvelope.fromJson(Map<String, dynamic> json) => _$PendingEnvelopeFromJson(json);
}

@freezed
class PendingEnvelopeMessage with _$PendingEnvelopeMessage {
  const factory PendingEnvelopeMessage({
    required String id,
    required String threadId,
    required String senderUserId,
    required String senderDeviceId,
    required int threadSequence,
    required DateTime createdAt,
  }) = _PendingEnvelopeMessage;

  factory PendingEnvelopeMessage.fromJson(Map<String, dynamic> json) => _$PendingEnvelopeMessageFromJson(json);
}
```

### `device_model.dart` (API)

```dart
@freezed
class Device with _$Device {
  const factory Device({
    required String id,
    required String platform,
    String? displayName,
    String? pushPlatform,
    bool? pushActive,
    DateTime? lastSeenAt,
    DateTime? createdAt,
  }) = _Device;

  factory Device.fromJson(Map<String, dynamic> json) => _$DeviceFromJson(json);
}
```

### `key_bundle.dart`

```dart
@freezed
class KeyBundle with _$KeyBundle {
  const factory KeyBundle({
    required String deviceId,
    required String userId,
    required String platform,
    required String identityPublicKey,
    required SignedPrekey signedPrekey,
    OneTimePrekey? oneTimePrekey,
  }) = _KeyBundle;

  factory KeyBundle.fromJson(Map<String, dynamic> json) => _$KeyBundleFromJson(json);
}

@freezed
class SignedPrekey with _$SignedPrekey {
  const factory SignedPrekey({
    required String id,
    required int keyId,
    required String publicKey,
    required String signature,
    required DateTime createdAt,
  }) = _SignedPrekey;

  factory SignedPrekey.fromJson(Map<String, dynamic> json) => _$SignedPrekeyFromJson(json);
}

@freezed
class OneTimePrekey with _$OneTimePrekey {
  const factory OneTimePrekey({
    required int keyId,
    required String publicKey,
  }) = _OneTimePrekey;

  factory OneTimePrekey.fromJson(Map<String, dynamic> json) => _$OneTimePrekeyFromJson(json);
}
```

### `media_model.dart`

```dart
enum MediaType { IMAGE, VIDEO, AUDIO, DOCUMENT }
enum UploadStatus { PENDING, COMPLETE }

@freezed
class MessageMedia with _$MessageMedia {
  const factory MessageMedia({
    required String id,
    required String messageId,
    required MediaType mediaType,
    required String mimeType,
    required int sizeBytes,
    required String filename,
    String? thumbnailBucketKey,
    int? width,
    int? height,
    int? duration,
    required String mediaCiphertextHash,
    String? thumbnailCiphertextHash,
    required UploadStatus uploadStatus,
    DateTime? uploadedAt,
    String? uploadSessionId,
    required DateTime createdAt,
  }) = _MessageMedia;

  factory MessageMedia.fromJson(Map<String, dynamic> json) => _$MessageMediaFromJson(json);
}

@freezed
class MediaInitResult with _$MediaInitResult {
  const factory MediaInitResult({
    required String mediaId,
    required String uploadUrl,
    required String bucketKey,
  }) = _MediaInitResult;

  factory MediaInitResult.fromJson(Map<String, dynamic> json) => _$MediaInitResultFromJson(json);
}
```

### `reaction_model.dart`

```dart
@freezed
class ReactionToggleResult with _$ReactionToggleResult {
  const factory ReactionToggleResult({
    required String action, // 'added' | 'removed'
    required String emoji,
    required String reactionId,
  }) = _ReactionToggleResult;

  factory ReactionToggleResult.fromJson(Map<String, dynamic> json) => _$ReactionToggleResultFromJson(json);
}

@freezed
class ReactionRemoveResult with _$ReactionRemoveResult {
  const factory ReactionRemoveResult({
    required bool removed,
  }) = _ReactionRemoveResult;

  factory ReactionRemoveResult.fromJson(Map<String, dynamic> json) => _$ReactionRemoveResultFromJson(json);
}

@freezed
class ReactionCount with _$ReactionCount {
  const factory ReactionCount({
    required String emoji,
    required int count,
    required bool reacted,
  }) = _ReactionCount;

  factory ReactionCount.fromJson(Map<String, dynamic> json) => _$ReactionCountFromJson(json);
}
```

---

## 4. API Client (`core/api/`)

### `api_client.dart`

```dart
class ApiClient {
  late final Dio _dio;

  ApiClient({required String baseUrl}) {
    _dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.add(AuthInterceptor());
  }

  Dio get dio => _dio;
}
```

### `AuthInterceptor` (in `api_client.dart`)

- On `401` response: try `POST /auth/refresh` with stored refresh token
- If refresh succeeds: update stored tokens, retry original request
- If refresh fails: set auth state to unauthenticated, navigate to login

```dart
class AuthInterceptor extends Interceptor {
  // Called on every request: attach current accessToken
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = ref.read(authProvider).accessToken;
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  // On 401: attempt token refresh, retry once
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      final refreshed = await _tryRefreshToken();
      if (refreshed) {
        // Retry with new token
        final retryResponse = await _retry(err.requestOptions);
        handler.resolve(retryResponse);
        return;
      }
    }
    handler.next(err);
  }
}
```

### `api_endpoints.dart`

```dart
class ApiEndpoints {
  static const String otpRequest = '/auth/otp/request';
  static const String otpVerify = '/auth/otp/verify';
  static const String refresh = '/auth/refresh';
  static const String logout = '/auth/logout';
  static const String devices = '/devices';
  static const String deviceRegister = '/devices/register';
  static String deviceDeactivate(String id) => '/devices/$id';
  static String prekeyCount(String deviceId) => '/devices/$deviceId/prekeys/count';
  static String prekeyRefill(String deviceId) => '/devices/$deviceId/prekeys/refill';
  static String signedPrekeyRotate(String deviceId) => '/devices/$deviceId/signed-prekey';
  static String userKeyBundles(String userId) => '/users/$userId/devices/key-bundles';
  static const String messages = '/messages';
  static const String messagesPending = '/messages/pending';
  static String messageAck(String messageId) => '/messages/$messageId/ack';
  static const String realtimeToken = '/realtime/token';
  static const String backupUploadUrl = '/backups/upload-url';
  static const String backupCurrent = '/backups/current';
  static const String backupMetadata = '/backups/metadata';
  static const String health = '/health';
}
```

### `auth_api.dart`

```dart
class AuthApi {
  final Dio _dio;
  AuthApi(this._dio);

  Future<Map<String, dynamic>> requestOtp(String phone) async {
    final response = await _dio.post(ApiEndpoints.otpRequest, data: {'phone': phone});
    return response.data;
  }

  Future<TokenPair> verifyOtp(String phone, String code) async {
    final response = await _dio.post(ApiEndpoints.otpVerify, data: {'phone': phone, 'code': code});
    return TokenPair.fromJson(response.data);
  }

  Future<TokenPair> refresh(String refreshToken) async {
    final response = await _dio.post(ApiEndpoints.refresh, data: {'refreshToken': refreshToken});
    return TokenPair.fromJson(response.data);
  }

  Future<void> logout(String? refreshToken) async {
    await _dio.post(ApiEndpoints.logout, data: refreshToken != null ? {'refreshToken': refreshToken} : null);
  }
}
```

### `device_api.dart`

```dart
class DeviceApi {
  final Dio _dio;
  DeviceApi(this._dio);

  Future<Device> register(Map<String, dynamic> data) async {
    final response = await _dio.post(ApiEndpoints.deviceRegister, data: data);
    return Device.fromJson(response.data);
  }

  Future<List<Device>> list() async {
    final response = await _dio.get(ApiEndpoints.devices);
    return (response.data as List).map((e) => Device.fromJson(e)).toList();
  }

  Future<void> deactivate(String deviceId) async {
    await _dio.delete(ApiEndpoints.deviceDeactivate(deviceId));
  }
}
```

### `prekey_api.dart`

```dart
class PrekeyApi {
  final Dio _dio;
  PrekeyApi(this._dio);

  Future<Map<String, dynamic>> getCount(String deviceId) async {
    final response = await _dio.get(ApiEndpoints.prekeyCount(deviceId));
    return response.data;
  }

  Future<int> refill(String deviceId, List<Map<String, dynamic>> prekeys) async {
    final response = await _dio.post(ApiEndpoints.prekeyRefill(deviceId), data: {'prekeys': prekeys});
    return response.data['inserted'] as int;
  }

  Future<void> rotateSignedPrekey(String deviceId, int keyId, String publicKey, String signature) async {
    await _dio.put(ApiEndpoints.signedPrekeyRotate(deviceId), data: {
      'keyId': keyId, 'publicKey': publicKey, 'signature': signature,
    });
  }
}
```

### `user_api.dart`

```dart
class UserApi {
  final Dio _dio;
  UserApi(this._dio);

  Future<List<KeyBundle>> getKeyBundles(String userId) async {
    final response = await _dio.get(ApiEndpoints.userKeyBundles(userId));
    final data = response.data;
    return (data['devices'] as List).map((e) => KeyBundle.fromJson(e)).toList();
  }
}
```

### `message_api.dart`

```dart
class MessageApi {
  final Dio _dio;
  MessageApi(this._dio);

  Future<Map<String, dynamic>> send(Map<String, dynamic> data) async {
    final response = await _dio.post(ApiEndpoints.messages, data: data);
    return response.data;
  }

  Future<Map<String, dynamic>> getPending(String deviceId, {String? after, int limit = 50}) async {
    final queryParams = {'deviceId': deviceId, 'limit': limit.toString()};
    if (after != null) queryParams['after'] = after;
    final response = await _dio.get(ApiEndpoints.messagesPending, queryParameters: queryParams);
    return response.data;
  }

  Future<void> ack(String messageId, String deviceId, String status) async {
    await _dio.post(ApiEndpoints.messageAck(messageId), data: {'deviceId': deviceId, 'status': status});
  }
}
```

### `realtime_api.dart`

```dart
class RealtimeApi {
  final Dio _dio;
  RealtimeApi(this._dio);

  Future<Map<String, dynamic>> createTicket(String deviceId) async {
    final response = await _dio.post(ApiEndpoints.realtimeToken, data: {'deviceId': deviceId});
    return response.data;
  }
}
```

### `backup_api.dart`

```dart
class BackupApi {
  final Dio _dio;
  BackupApi(this._dio);

  Future<Map<String, dynamic>> getUploadUrl(int sizeBytes) async {
    final response = await _dio.post(ApiEndpoints.backupUploadUrl, data: {'sizeBytes': sizeBytes});
    return response.data;
  }

  Future<void> putCurrent(int version, String bucketKey, String sha256, int sizeBytes) async {
    await _dio.put(ApiEndpoints.backupCurrent, data: {
      'version': version, 'bucketKey': bucketKey, 'sha256': sha256, 'sizeBytes': sizeBytes,
    });
  }

  Future<Map<String, dynamic>> getCurrent() async {
    final response = await _dio.get(ApiEndpoints.backupCurrent);
    return response.data;
  }

  Future<Map<String, dynamic>> getMetadata() async {
    final response = await _dio.get(ApiEndpoints.backupMetadata);
    return response.data;
  }
}
```

### `media_api.dart`

```dart
class MediaApi {
  final Dio _dio;
  MediaApi(this._dio);

  /// Step 1: claim a slot and get a presigned R2 PUT URL.
  Future<MediaInitResult> init({
    required String mediaType,
    required String filename,
    required String mimeType,
    required int sizeBytes,
    required String mediaCiphertextHash,
    int? width,
    int? height,
    int? duration,
    String? thumbnailCiphertextHash,
    List<int>? thumbnailBytes,
  }) async {
    final response = await _dio.post(ApiEndpoints.mediaInit, data: {
      'mediaType': mediaType,
      'filename': filename,
      'mimeType': mimeType,
      'sizeBytes': sizeBytes,
      'mediaCiphertextHash': mediaCiphertextHash,
      if (width != null) 'width': width,
      if (height != null) 'height': height,
      if (duration != null) 'duration': duration,
      if (thumbnailCiphertextHash != null) 'thumbnailCiphertextHash': thumbnailCiphertextHash,
    });
    return MediaInitResult.fromJson(response.data);
  }

  /// Step 2: PUT the encrypted blob directly to R2.
  Future<void> uploadToR2({
    required String uploadUrl,
    required List<int> encryptedBytes,
    required String mimeType,
    required int sizeBytes,
  }) async {
    await Dio().put(
      uploadUrl,
      data: Stream.fromIterable([encryptedBytes]),
      options: Options(
        headers: {
          Headers.contentLengthHeader: sizeBytes,
          Headers.contentTypeHeader: mimeType,
        },
      ),
    );
  }

  /// Step 2b (optional): upload thumbnail to R2.
  Future<void> uploadThumbnailToR2({
    required String uploadUrl,
    required List<int> encryptedBytes,
    required String mimeType,
    required int sizeBytes,
  }) async {
    await Dio().put(
      uploadUrl,
      data: Stream.fromIterable([encryptedBytes]),
      options: Options(
        headers: {
          Headers.contentLengthHeader: sizeBytes,
          Headers.contentTypeHeader: mimeType,
        },
      ),
    );
  }

  /// Step 3: verify the PUT and flip the row to COMPLETE.
  Future<void> complete(String mediaId, int sizeBytes) async {
    await _dio.post(
      ApiEndpoints.mediaComplete(mediaId),
      data: {'sizeBytes': sizeBytes},
    );
  }

  /// Fetch a short-lived presigned download URL.
  Future<String> getDownloadUrl(String mediaId) async {
    final response = await _dio.get(ApiEndpoints.mediaDownloadUrl(mediaId));
    return response.data['downloadUrl'] as String;
  }
}
```

### `reactions_api.dart`

```dart
class ReactionsApi {
  final Dio _dio;
  ReactionsApi(this._dio);

  /// Toggle an emoji reaction on a message (add if not present, remove if same).
  /// Returns { action: 'added' | 'removed', emoji: string, reactionId: string }
  Future<ReactionToggleResult> toggle(String messageId, String emoji) async {
    final response = await _dio.post(
      ApiEndpoints.reactionToggle(messageId),
      data: {'emoji': emoji},
    );
    return ReactionToggleResult.fromJson(response.data);
  }

  /// Remove the current user's reaction from a message.
  Future<ReactionRemoveResult> remove(String messageId) async {
    final response = await _dio.delete(ApiEndpoints.reactionRemove(messageId));
    return ReactionRemoveResult.fromJson(response.data);
  }

  /// Get aggregated reaction counts for a message, including whether the current user reacted.
  Future<List<ReactionCount>> getAggregated(String messageId) async {
    final response = await _dio.get(ApiEndpoints.reactionAggregated(messageId));
    return (response.data as List).map((e) => ReactionCount.fromJson(e)).toList();
  }
}
```

Where `ApiEndpoints` gains:
```dart
static const String mediaInit = '/messages/media/init';
static String mediaComplete(String id) => '/messages/media/$id/complete';
static String mediaDownloadUrl(String id) => '/messages/media/$id/download-url';
static String reactionToggle(String messageId) => '/reactions/$messageId';
static String reactionRemove(String messageId) => '/reactions/$messageId';
static String reactionAggregated(String messageId) => '/reactions/$messageId/aggregated';
```

Where `ApiEndpoints` gains:
```dart
static const String mediaInit = '/messages/media/init';
static String mediaComplete(String id) => '/messages/media/$id/complete';
static String mediaDownloadUrl(String id) => '/messages/media/$id/download-url';
```

---

## 5. Socket.IO (`core/socket/`)

### `socket_manager.dart`

```dart
class SocketManager {
  Socket? _socket;
  final _messageNewController = StreamController<Map<String, dynamic>>.broadcast();
  final _messageAckController = StreamController<Map<String, dynamic>>.broadcast();
  final _typingController = StreamController<Map<String, String>>.broadcast();
  final _presenceController = StreamController<Map<String, String>>.broadcast();
  final _reactionNewController = StreamController<Map<String, dynamic>>.broadcast();
  final _reactionRemovedController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get onMessageNew => _messageNewController.stream;
  Stream<Map<String, dynamic>> get onMessageAck => _messageAckController.stream;
  Stream<Map<String, String>> get onTyping => _typingController.stream;
  Stream<Map<String, String>> get onPresence => _presenceController.stream;
  Stream<Map<String, dynamic>> get onReactionNew => _reactionNewController.stream;
  Stream<Map<String, dynamic>> get onReactionRemoved => _reactionRemovedController.stream;

  bool get isConnected => _socket?.connected ?? false;

  Future<void> connect(String ticket) async {
    _socket = io(AppConfig.baseUrl, OptionBuilder()
      .setTransports(['websocket'])
      .setAuth({'ticket': ticket})
      .enableForceNew()
      .build());

    _socket!.on('message.new', (data) => _messageNewController.add(data));
    _socket!.on('message.ack', (data) => _messageAckController.add(data));
    _socket!.on('typing.start', (data) => _typingController.add({'type': 'start', ...data}));
    _socket!.on('typing.stop', (data) => _typingController.add({'type': 'stop', ...data}));
    _socket!.on('presence.active', (data) => _presenceController.add(data));
    _socket!.on('reaction.new', (data) => _reactionNewController.add(data));
    _socket!.on('reaction.removed', (data) => _reactionRemovedController.add(data));
  }

  void sendTypingStart(String? recipientUserId, {String? groupId}) {
    if (groupId != null) {
      _socket?.emit('typing.start', {'groupId': groupId});
    } else if (recipientUserId != null) {
      _socket?.emit('typing.start', {'recipientUserId': recipientUserId});
    }
  }

  void sendTypingStop(String? recipientUserId, {String? groupId}) {
    if (groupId != null) {
      _socket?.emit('typing.stop', {'groupId': groupId});
    } else if (recipientUserId != null) {
      _socket?.emit('typing.stop', {'recipientUserId': recipientUserId});
    }
  }

  void disconnect() {
    _socket?.disconnect();
    _socket = null;
  }

  void dispose() {
    disconnect();
    _messageNewController.close();
    _messageAckController.close();
    _typingController.close();
    _presenceController.close();
    _reactionNewController.close();
    _reactionRemovedController.close();
  }
}
```

---

## 6. Crypto / E2EE (`core/crypto/`)

### `identity_key_store.dart`

```dart
class IdentityKeyStore {
  final SecureStorageManager _storage;

  IdentityKeyStore(this._storage);

  Future<bool> hasIdentityKey() async {
    final key = await _storage.read('identity_private_key');
    return key != null;
  }

  Future<Map<String, String>> getOrCreateIdentityKey() async {
    // Generate Curve25519 key pair
    // Store private key in secure storage
    // Return { publicKey: base64, privateKey: base64 }
  }

  Future<String> getPublicKey() async {
    return await _storage.read('identity_public_key') ?? '';
  }

  Future<String> getPrivateKey() async {
    return await _storage.read('identity_private_key') ?? '';
  }
}
```

### `prekey_store.dart`

```dart
class PrekeyStore {
  Future<Map<String, dynamic>> generateOneTimePrekeys({int count = 100}) async {
    // Generate `count` one-time prekey pairs
    // Store private keys in secure storage
    // Return list of { keyId, publicKey } for upload
  }

  Future<Map<String, dynamic>> generateSignedPrekey(String identityPrivateKey) async {
    // Generate new signed prekey
    // Sign with identity key
    // Return { keyId, publicKey, signature } for upload
  }

  Future<int> refillIfNeeded(PrekeyApi api, String deviceId) async {
    // GET /prekeys/count
    // If lowWatermark or remaining < 10: generate + POST /prekeys/refill
  }
}
```

### `session_store.dart`

```dart
class SessionStore {
  // Key: "session:{ourDeviceId}:{theirUserId}:{theirDeviceId}"
  // Value: Signal session state (serialized)

  Future<bool> hasSession(String ourDeviceId, String theirUserId, String theirDeviceId) async {
    final key = 'session:$ourDeviceId:$theirUserId:$theirDeviceId';
    return await _storage.containsKey(key);
  }

  Future<void> saveSession(String ourDeviceId, String theirUserId, String theirDeviceId, SessionState state) async {
    // Serialize and store
  }

  Future<SessionState?> loadSession(String ourDeviceId, String theirUserId, String theirDeviceId) async {
    // Load and deserialize
  }
}
```

### `message_encryptor.dart`

```dart
class MessageEncryptor {
  Future<Map<String, dynamic>> encryptForDevice({
    required String plaintext,
    required String ourDeviceId,
    required String theirUserId,
    required String theirDeviceId,
    required KeyBundle theirKeyBundle,
  }) async {
    // 1. Load or create Signal session
    // 2. If no session: X3DH using theirKeyBundle (identityKey, signedPrekey, oneTimePrekey)
    // 3. Encrypt plaintext with session
    // 4. Return { type: "signal-message", body: base64-ciphertext, metadata: { ... } }
  }
}
```

### `message_decryptor.dart`

```dart
class MessageDecryptor {
  Future<String> decryptEnvelope({
    required Map<String, dynamic> ciphertext,
    required String ourDeviceId,
    required String theirUserId,
    required String theirDeviceId,
  }) async {
    // 1. Load existing session
    // 2. Decrypt ciphertext.body
    // 3. Return plaintext
  }
}
```

---

## 7. Local Database (`core/storage/local_database.dart`)

Drift schema:

```dart
// Table: messages
//   id TEXT PK
//   threadId TEXT NOT NULL
//   senderUserId TEXT NOT NULL
//   senderDeviceId TEXT NOT NULL
//   threadSequence INTEGER NOT NULL
//   text TEXT
//   status TEXT NOT NULL (sending/pending/delivered/read/failed)
//   createdAt INTEGER NOT NULL (ms epoch)
//   deliveredAt INTEGER
//   readAt INTEGER
//   envelopeSequence TEXT (for dedup with pending poll)

// Table: threads
//   id TEXT PK
//   otherUserId TEXT NOT NULL
//   otherUserName TEXT
//   lastMessagePreview TEXT
//   lastMessageSequence INTEGER
//   lastMessageAt INTEGER
//   unreadCount INTEGER NOT NULL DEFAULT 0

// Table: pending_operations (for offline queue)
//   id INTEGER AUTOINCREMENT PK
//   operationType TEXT NOT NULL (send_message)
//   payload TEXT NOT NULL (JSON)
//   createdAt INTEGER NOT NULL
```

---

## 8. Providers (Riverpod)

### `auth_provider.dart`

```dart
@riverpod
class AuthNotifier extends _$AuthNotifier {
  @override
  AuthState build() => const AuthState.unauthenticated();

  Future<void> requestOtp(String phone) async { ... }
  Future<void> verifyOtp(String phone, String code) async { ... }
  Future<void> refreshSession() async { ... }
  Future<void> logout() async { ... }
}
```

### `chat_list_provider.dart`

```dart
@riverpod
Stream<List<Thread>> chatList(ChatListRef ref) {
  final db = ref.watch(databaseProvider);
  return db.watchThreads();
}
```

### `message_list_provider.dart`

```dart
@riverpod
class MessageList extends _$MessageList {
  @override
  Future<List<Message>> build(String threadId) async {
    final db = ref.watch(databaseProvider);
    return db.getMessages(threadId);
  }
}
```

### `send_message_provider.dart`

```dart
@riverpod
class SendMessage extends _$SendMessage {
  @override
  FutureOr<void> build() {}

  Future<void> send(String threadId, String recipientUserId, String text) async {
    state = const AsyncLoading();
    try {
      // 1. GET /users/:recipientUserId/devices/key-bundles
      // 2. For each device: encrypt with MessageEncryptor
      // 3. Include self-sync envelopes for own other devices
      // 4. POST /messages with idempotencyKey
      // 5. Save to local DB with status "sending"
      // 6. Update status to "pending" on server response
      state = const AsyncData(null);
    } catch (e) {
      state = AsyncError(e, StackTrace.current);
    }
  }
}
```

### `pending_poller.dart`

```dart
@riverpod
class PendingPoller extends _$PendingPoller {
  @override
  FutureOr<void> build() {
    // Listen to socket.onMessageNew
    // On trigger: GET /messages/pending?deviceId=X
    // For each envelope: decrypt, store locally, ACK DELIVERED
    ref.onDispose(() { /* cleanup */ });
  }
}
```

---

## 9. Push Service (`core/push/push_service.dart`)

```dart
class PushService {
  Future<void> init() async {
    await Firebase.initializeApp();
    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission();
    final token = await messaging.getToken();

    // Register token with device via POST /devices/register (or update)
    // Handle token refresh:
    FirebaseMessaging.instance.onTokenRefresh.listen((newToken) {
      // Update device pushToken
    });

    // Handle foreground messages:
    FirebaseMessaging.onMessage.listen((message) {
      if (message.data['type'] == 'new_message') {
        // Trigger pending poll
      }
    });

    // Handle background messages:
    FirebaseMessaging.onBackgroundMessage(_backgroundHandler);
  }

  @pragma('vm:entry-point')
  static Future<void> _backgroundHandler(RemoteMessage message) async {
    // Wake up device, trigger pending poll via background isolate
  }
}
```

---

## 10. Key Flows — Exact Implementation Steps

### Startup Flow (runApp → home screen)

```
1. main.dart: ProviderScope → App
2. App: MaterialApp.router with GoRouter
3. GoRouter: redirect to /login if unauthenticated, /home if authenticated
4. AuthProvider.build():
   a. Check secure storage for refreshToken + userId + deviceId
   b. If exists: call POST /auth/refresh → get new accessToken
   c. If succeeds: state = authenticated(...)
   d. If fails: state = unauthenticated
5. On authenticated state:
   a. PushService.init()
   b. SocketManager.connect(ticket)
   c. PendingPoller.build() starts listening
   d. PrekeyStore.refillIfNeeded()
   e. Navigate to /home
```

### Device Registration Flow (first login)

```
1. After OTP verify → have userId, accessToken, refreshToken
2. Check SecureStorage for existing deviceId
3. If no deviceId:
   a. IdentityKeyStore.getOrCreateIdentityKey()
   b. Generate UUID v4 as deviceId
   c. POST /devices/register with { deviceId, platform, identityPublicKey }
   d. PrekeyStore.generateSignedPrekey() → PUT /devices/:id/signed-prekey
   e. PrekeyStore.generateOneTimePrekeys(100) → POST /devices/:id/prekeys/refill
   f. Store deviceId in SecureStorage
4. If deviceId exists:
   a. POST /devices/register with { deviceId, platform, identityPublicKey }
   b. Check prekey count, refill if < 10 remaining
```

### Send Message Flow

```
1. User types message, taps send
2. Generate idempotencyKey: UUID v4 (8+ chars)
3. Fetch bundles: GET /users/:recipientUserId/devices/key-bundles
4. GET /devices → get own other devices (for sender-sync)
5. For each recipient device + own other devices:
   a. encryptor.encryptForDevice(plaintext, theirKeyBundle)
   b. Build envelope { recipientDeviceId, ciphertext }
6. POST /messages: { senderDeviceId, recipientUserId, idempotencyKey, envelopes }
7. On success:
   a. Save message to local DB with { id, threadId, threadSequence, status: pending }
   b. Reconcile: mark local "sending" placeholder as confirmed
   c. Show in chat UI
8. On failure:
   a. If 401: refresh token, retry (idempotencyKey prevents duplicates)
   b. If 400/404: show error, mark message as "failed"
```

### Receive Message Flow

```
1. Socket receives message.new event → payload: envelope data
2. PendingPoller:
   a. GET /messages/pending?deviceId=X (cursor loop until hasMore=false)
   b. For each envelope:
      - threadId from envelope.message.threadId
      - decrypt: decryptor.decryptEnvelope(ciphertext)
      - Save to local DB
      - If thread not in local DB: create thread entry
      - If chat is in foreground and this thread is open: show immediately
      - POST /messages/:id/ack with status=DELIVERED
3. When user opens message / enters chat:
   - POST /messages/:id/ack with status=READ
   - WebSocket relays message.ack to sender
```

### Token Refresh Flow

```
1. Any API call returns 401
2. AuthInterceptor.onError:
   a. Read refreshToken from SecureStorage
   b. POST /auth/refresh { refreshToken }
   c. On success: store new tokens, retry original request
   d. On failure (expired/invalid refresh):
      - Clear all stored tokens
      - Set auth state to unauthenticated
      - GoRouter redirects to /login
```

### WebSocket Reconnect Flow

```
1. SocketManager detects disconnect
2. Wait 1s → POST /realtime/token → get new ticket → reconnect
3. On reconnect: trigger PendingPoller to catch up on missed messages
```

### Backup Flow

```
1. User triggers backup in settings
2. Export local messages/threads from Drift → serialize → JSON
3. Encrypt JSON with user-defined password (AES-256-GCM, key derived with PBKDF2)
4. POST /backups/upload-url { sizeBytes }
5. PUT encrypted blob to uploadUrl (directly to R2)
6. PUT /backups/current { version, bucketKey, sha256, sizeBytes }
```

### Media Attachment Flow (Images, Videos, GIFs, Audio, Documents)

```
1. User selects media from gallery / camera / GIF picker
2. Client encrypts the file locally (AES-256-GCM, random key per file)
3. Compute SHA-256 of ciphertext → mediaCiphertextHash
4. Optional: generate thumbnail (max 300px), encrypt → thumbnailCiphertextHash
5. POST /messages/media/init with:
   {
     mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT",
     filename: "original-filename.gif",
     mimeType: "image/gif",
     sizeBytes: <encrypted_size>,
     mediaCiphertextHash: "<sha256>",
     width?: 1920,
     height?: 1080,
     duration?: 5000,
     thumbnailCiphertextHash?: "<sha256>"
   }
6. Receive { mediaId, uploadUrl, bucketKey }
7. PUT encrypted bytes to uploadUrl with Content-Type = mimeType
8. POST /messages/media/:mediaId/complete { sizeBytes }
9. Repeat for each attachment (max 10)
10. Include mediaIds[] in POST /messages
```

**GIF specifics:**
- MIME type: `image/gif` → sent as `mediaType: "IMAGE"`
- No server-side transcoding (E2EE prevents it)
- Large GIFs (>5MB): client MAY locally transcode to H.264 MP4 (no audio) and upload as `mediaType: "VIDEO"` with `duration`, `width`, `height`
- Render: `image/gif` → `Image.memory()` or `CachedNetworkImage`; `video/mp4` loops → `VideoPlayer` with `loop: true, muted: true`

**Thumbnails:**
- Generate locally before encryption (e.g., 300px max dimension)
- Encrypt thumbnail separately, upload via second R2 PUT if API supports it
- Include `thumbnailCiphertextHash` in init payload

### GIF Search & Send Flow (Client-Side Only)

```
1. User taps GIF button in composer
2. App calls Giphy / Tenor API directly (requires API key in app config)
3. Render results in grid panel (NOT inline bot popup)
4. User taps a GIF → download to temp file
5. Encrypt locally → run Media Attachment Flow (steps 2-10 above)
6. Send message with mediaIds[]
```

- No backend endpoint for GIF search (privacy: server never sees search queries)
- Giphy/Tenor API key stored in app config / `--dart-define`
- Cache recent searches locally (SQLite, encrypted)

### Saved GIFs (Local-Only)

```
- Store favorited GIF mediaIds in local Drift table: `saved_gifs (mediaId, addedAt)`
- Max 50 entries (LRU eviction when full)
- Sync via encrypted backup (included in backup blob)
- No server API — fully client-side
```

### Reactions Flow

```
1. User long-presses message → emoji picker (20 allowed: 👍 👎 ❤️ 🔥 😂 😮 😢 🎉 🙏 💯 👏 🤔 😍 🥳 😎 💪 ✨ 🚀 👀 💀)
2. Tap emoji → POST /reactions/:messageId { emoji }
3. Server returns { action: "added" | "removed", emoji, reactionId }
4. WebSocket broadcasts reaction.new / reaction.removed to thread participants
5. On receive: update local reaction counts, animate emoji
6. Tap same emoji again → toggle off (action: "removed")
7. GET /reactions/:messageId/aggregated → { emoji, count, reacted } for initial load
```

**Real-time events:**
- `reaction.new`: { reactionId, messageId, userId, emoji, createdAt, threadId?, groupId? }
- `reaction.removed`: { reactionId, messageId, userId, emoji, threadId?, groupId? }
- Emit only to other participants (not sender)
- Cache aggregated counts in Redis (5-min TTL) — API returns cached data when available

---

## 11. Error Handling Strategy

| HTTP Code | Client Action |
|-----------|---------------|
| 401 | Retry with refreshed token once; if still 401, logout |
| 403 | Show toast "Session revoked" → logout |
| 404 | Show "User/device not found" |
| 409 | Navigate to device management screen |
| 429 | Retry with exponential backoff (1s, 2s, 4s, max 30s) |
| 5xx | Show "Server error, try again" + retry button |

Network errors (no connection):
- Queue outgoing messages in `pending_operations` table
- Show "Waiting for network" banner
- On connectivity restored: flush queue

---

## 12. Environment / Config

```dart
class AppConfig {
  static const String baseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://localhost:3000');
  static const Duration accessTokenBuffer = Duration(minutes: 2); // Refresh 2min before expiry
  static const int pendingPollLimit = 50;
  static const int typingTimeoutSeconds = 3;
  static const int oneTimePrekeyRefillThreshold = 10;
  static const int oneTimePrekeyBatchSize = 100;
  static const int signedPrekeyRotationDays = 7;
  static const int maxDevices = 3;
}
```

---

## 13. pubspec.yaml Dependencies

```yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_riverpod: ^2.6.1
  riverpod_annotation: ^2.6.1
  dio: ^5.7.0
  socket_io_client: ^3.0.2
  drift: ^2.22.1
  sqlite3_flutter_libs: ^0.5.0
  path_provider: ^2.1.5
  path: ^1.9.0
  flutter_secure_storage: ^9.2.4
  go_router: ^14.6.2
  firebase_core: ^3.12.1
  firebase_messaging: ^15.2.1
  libsignal_protocol_dart: ^0.8.0
  freezed_annotation: ^2.4.4
  json_annotation: ^4.9.0
  uuid: ^4.5.1
  permission_handler: ^11.3.1
  intl: ^0.19.0
  workmanager: ^0.5.2

dev_dependencies:
  flutter_test:
    sdk: flutter
  build_runner: ^2.4.13
  riverpod_generator: ^2.6.3
  freezed: ^2.5.7
  json_serializable: ^6.9.0
  drift_dev: ^2.22.1
  flutter_lints: ^5.0.0
```

---

## 14. iOS Specifics

- `ios/Runner/Info.plist`: Add `UIBackgroundModes` with `remote-notification` for silent push
- `ios/Podfile`: `platform :ios, '13.0'` minimum
- Firebase: Download `GoogleService-Info.plist`, add to Runner target
- Keychain access group for `flutter_secure_storage`

---

## 15. Android Specifics

- `android/app/build.gradle`: `minSdk 23`, `targetSdk 34`
- `android/app/google-services.json` from Firebase Console
- `android/app/src/main/AndroidManifest.xml`: internet permission, FCM default channel
- WorkManager for background message processing

---

## 16. Build Order (for AI Agent)

1. **Phase 1 — Scaffold**: pubspec.yaml, main.dart, app.dart, go_router setup, auth screens
2. **Phase 2 — API Layer**: api_client.dart, all API classes, models (freezed)
3. **Phase 3 — Auth Flow**: auth_provider, phone_input_screen, otp_verify_screen, token refresh
4. **Phase 4 — Crypto**: identity_key_store, prekey_store, session_store, encryptor/decryptor
5. **Phase 5 — Device Registration**: device_api, registration flow after auth
6. **Phase 6 — Local DB**: drift schema, helpers
7. **Phase 7 — Chat**: chat_list_screen, chat_screen, send/receive message providers
8. **Phase 8 — WebSocket**: socket_manager, pending_poller, typing indicators
9. **Phase 9 — Push**: FCM init, token management, background handler
10. **Phase 10 — Polish**: backups, device management, error handling, offline queue

---

## 17. Rules the Agent Must Follow

- Never commit plaintext messages to the API
- Never log private keys or message content
- Never store tokens in SharedPreferences or unencrypted storage
- Use `flutter_secure_storage` for ALL sensitive data: tokens, identity private key, prekey private keys, session state
- The `ciphertext` field in envelopes is opaque JSON — the app controls its schema
- Always use `idempotencyKey` for message sends (UUID v4, 8+ chars)
- Always support `oneTimePrekey: null` fallback in session initialization
- Always poll `GET /messages/pending` after WebSocket reconnect
- Use `threadSequence` for final message ordering, not `envelopeSequence`
- Expire typing indicators client-side after 3 seconds
- Rotate signed prekeys every 7 days
- Refill one-time prekeys when count drops below 10
