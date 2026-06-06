# Location Sharing Plan

## Overview

Add static location and venue sharing to BirGap. Users can send their current GPS position (static pin) or pick a named place (venue with title + address). Location data lives entirely inside the encrypted payload — the server is a zero-knowledge relay and **requires no changes**.

**Design decisions:**

- **Static location only** — no live location, no real-time GPS broadcasting, no group live map
- **Server already supports this** — `MessageContentType.LOCATION` and `MessageContentType.VENUE` exist in the Prisma schema and `SendMessageDto`. Push notifications are silent wakeups (client decrypts + renders), so no push changes needed.
- **Location data is encrypted** — lat/lng/title/address are inside the ciphertext JSON, opaque to the server
- **Map tiles are client-fetched** — no server dependency for rendering
- **POI search is client-side** — like GIF search, the app calls the geocoding API directly (privacy: server never sees search queries)
- **Map tile provider: `flutter_map` + OSM tiles** — free, no API key, good enough for Central Asia. Mapbox can be swapped later.
- **POI search: Nominatim (OSM)** — free, no API key. Google Places can be swapped later if coverage is insufficient.
- **Tap-to-open: system maps** — via `map_launcher` package (opens Apple Maps / Google Maps / Yandex Maps)

---

## 1. Backend Changes

**None.** The backend already has:

- `MessageContentType` enum with `TEXT`, `LOCATION`, `VENUE` (`prisma/schema.prisma:61-65`, `src/messages/enums/content-type.enum.ts`)
- `SendMessageDto.contentType` field (`src/messages/dto/send-message.dto.ts`)
- `MessagesService.send()` stores `contentType: dto.contentType ?? 'TEXT'` (`src/messages/messages.service.ts:137`)
- Silent push wakeups — client decrypts and renders notification text locally

---

## 2. Mobile Spec Updates — Data Models

### Updated `message_model.dart`

```dart
@freezed
class Message with _$Message {
  const factory Message({
    required String id,
    required String threadId,
    required String senderUserId,
    required String senderDeviceId,
    required int threadSequence,
    @Default(MessageContentType.text) MessageContentType contentType,
    required String? text,
    // Location fields (null for text messages)
    double? latitude,
    double? longitude,
    double? horizontalAccuracy,
    // Venue fields (null for text/location messages)
    String? venueTitle,
    String? venueAddress,
    String? googlePlaceId,
    String? googlePlaceType,
    // Existing fields
    required MessageStatus status,
    @Default(false) bool forwarded,
    required DateTime createdAt,
    DateTime? deliveredAt,
    DateTime? readAt,
  }) = _Message;

  factory Message.fromJson(Map<String, dynamic> json) => _$MessageFromJson(json);
}

enum MessageContentType { text, location, venue }
```

### New `location_data.dart`

```dart
@freezed
class LocationData with _$LocationData {
  const factory LocationData({
    required double latitude,
    required double longitude,
    double? horizontalAccuracy,
  }) = _LocationData;

  factory LocationData.fromJson(Map<String, dynamic> json) => _$LocationDataFromJson(json);
}

@freezed
class VenueData with _$VenueData {
  const factory VenueData({
    required double latitude,
    required double longitude,
    required String title,
    String? address,
    String? googlePlaceId,
    String? googlePlaceType,
  }) = _VenueData;

  factory VenueData.fromJson(Map<String, dynamic> json) => _$VenueDataFromJson(json);
}
```

---

## 3. Mobile Spec Updates — Drift Schema

### Updated `messages` table

```dart
// Table: messages
//   ... existing columns ...
//   contentType TEXT NOT NULL DEFAULT 'TEXT' (TEXT | LOCATION | VENUE)
//   text TEXT
//   latitude REAL              // NEW: nullable, set for LOCATION and VENUE
//   longitude REAL             // NEW: nullable, set for LOCATION and VENUE
//   horizontalAccuracy REAL    // NEW: nullable, meters (0-1500), LOCATION only
//   venueTitle TEXT            // NEW: nullable, VENUE only
//   venueAddress TEXT          // NEW: nullable, VENUE only
//   googlePlaceId TEXT         // NEW: nullable, VENUE only
//   googlePlaceType TEXT       // NEW: nullable, VENUE only
```

**Migration:** Add 7 nullable columns to existing `messages` table. No data backfill needed (all nullable).

---

## 4. Encrypted Payload Schema

Plaintext JSON inside the ciphertext (what gets encrypted per-device):

```json
// Text (existing)
{ "type": "text", "text": "Hello" }

// Static location
{ "type": "location", "latitude": 41.2995, "longitude": 69.2401, "horizontalAccuracy": 15.5 }

// Venue / place
{ "type": "venue", "latitude": 41.2995, "longitude": 69.2401, "title": "Broadway", "address": "Sayilgoh St, Tashkent", "googlePlaceId": "ChIJ...", "googlePlaceType": "restaurant" }
```

---

## 5. File Structure Additions

```
lib/
├── features/
│   └── chat/
│       ├── widgets/
│       │   ├── location_picker_screen.dart      // NEW: full-screen map + search
│       │   ├── location_bubble.dart              // NEW: map thumbnail in message list
│       │   └── poi_search_panel.dart             // NEW: search overlay in picker
│       └── providers/
│           └── location_provider.dart            // NEW: GPS + POI search providers
├── core/
│   ├── location/
│   │   ├── map_tile_service.dart                 // NEW: OSM tile URL builder
│   │   └── poi_search_service.dart               // NEW: Nominatim API client
│   └── models/
│       └── location_data.dart                    // NEW: LocationData + VenueData freezed
```

---

## 6. Location Picker Screen

### `location_picker_screen.dart`

```
Layout:
┌──────────────────────────────────┐
│ ← Location                  [Send]│
├──────────────────────────────────┤
│ ┌──────────────────────────────┐ │
│ │ 🔍 Search for a place...    │ │
│ └──────────────────────────────┘ │
│                                  │
│         ┌──────────┐             │
│         │  📍 MAP  │             │
│         │   PIN    │             │
│         └──────────┘             │
│                                  │
├──────────────────────────────────┤
│ 📍 Send Current Location         │
│    Accuracy: ~15m                │
├──────────────────────────────────┤
│ Nearby Places                    │
│ ┌──────────────────────────────┐ │
│ │ 🏪 Broadway                  │ │
│ │    Sayilgoh St, Tashkent     │ │
│ ├──────────────────────────────┤ │
│ │ 🍽️ Central Asian Plov Center │ │
│ │    Navoi St, Tashkent        │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

### Flow

```
1. User taps location button (📍) in composer action menu
2. App requests location permission (permission_handler)
   - If denied: show "Enable location" prompt → open system settings
3. Get current GPS position via geolocator package
4. Show LocationPickerScreen:
   a. Center map on current position
   b. Fetch nearby POIs from Nominatim (reverse geocode + nearby search)
   c. Show "Send Current Location" button with accuracy
   d. Show list of nearby places
5. User can:
   a. Tap "Send Current Location" → send as contentType: LOCATION
   b. Tap a nearby place → send as contentType: VENUE
   c. Search for a place → Nominatim search → tap result → send as VENUE
   d. Pan map → update center → re-fetch nearby POIs
6. On send:
   a. Build plaintext JSON (location or venue schema)
   b. Follow standard Send Message Flow (encrypt → POST /messages)
```

---

## 7. Location Bubble (Message Rendering)

### `location_bubble.dart`

```
For LOCATION messages:
┌────────────────────────────┐
│ ┌────────────────────────┐ │
│ │                        │ │
│ │    [Map Thumbnail]     │ │
│ │        📍              │ │
│ │                        │ │
│ └────────────────────────┘ │
│ Location                   │
└────────────────────────────┘

For VENUE messages:
┌────────────────────────────┐
│ 🏪 Broadway                │
│ Sayilgoh St, Tashkent      │
│ ┌────────────────────────┐ │
│ │                        │ │
│ │    [Map Thumbnail]     │ │
│ │        📍              │ │
│ │                        │ │
│ └────────────────────────┘ │
└────────────────────────────┘
```

### Map thumbnail rendering

- Use `flutter_map` with OSM tiles to render a static 300×200 map region
- Center on `latitude`/`longitude`, zoom level 15
- Overlay a pin marker at center
- Wrap in `IgnorePointer` (non-interactive in the bubble)
- Cache tiles with `flutter_map`'s built-in tile cache

### Tap behavior

- Tap on location bubble → open `map_launcher` to show location in system maps app
  - iOS: Apple Maps (default), Google Maps, Yandex Maps
  - Android: Google Maps (default), Yandex Maps
- Fallback: open `flutter_map` in a full-screen interactive view

---

## 8. POI Search

### `poi_search_service.dart`

Client-side only (like GIF search). Uses Nominatim (OpenStreetMap):

```dart
class PoiSearchService {
  static const _baseUrl = 'https://nominatim.openstreetmap.org';

  Future<List<VenueData>> searchNearby(double lat, double lng) async {
    // GET /search?format=json&lat=X&lon=Y&limit=20&addressdetails=1
    //   &extratags=1&q=restaurant+cafe+shop
    // Parse response → List<VenueData>
  }

  Future<List<VenueData>> search(String query, double nearLat, double nearLng) async {
    // GET /search?format=json&q=QUERY&lat=X&lon=Y&limit=20&addressdetails=1
    // Parse response → List<VenueData>
  }
}
```

**Nominatim usage policy:**
- Max 1 request/second (enforced with `RateLimiter`)
- Set `User-Agent: BirGap/1.0` header (required by Nominatim ToS)
- Cache results locally (5-min TTL, keyed by query + lat/lng cell)

**Fallback:** If Nominatim coverage in Central Asia is insufficient, swap to Google Places API (requires API key + billing). The `PoiSearchService` interface stays the same.

---

## 9. Thread List Preview

When the last message in a thread is a location/venue, the thread list shows:

| contentType | Preview text |
|-------------|-------------|
| `LOCATION` | `📍 Location` |
| `VENUE` | `📍 {venueTitle}` |

Update `threads` table's `lastMessagePreview` logic in the local DB helper:

```dart
String messagePreview(Message msg) {
  switch (msg.contentType) {
    case MessageContentType.location:
      return '📍 Location';
    case MessageContentType.venue:
      return '📍 ${msg.venueTitle ?? 'Location'}';
    default:
      return msg.text ?? '';
  }
}
```

---

## 10. pubspec.yaml Additions

```yaml
dependencies:
  # ... existing ...
  flutter_map: ^7.0.2              # Map rendering (OSM tiles)
  latlong2: ^0.9.1                 # LatLng type for flutter_map
  geolocator: ^13.0.2              # GPS position
  permission_handler: ^11.3.1      # Already listed — needed for location permission
  map_launcher: ^3.5.0             # Open in system maps app
  cached_network_image: ^3.4.1     # Map tile caching (already used for media)
```

**No API keys needed** — OSM tiles and Nominatim are free and keyless.

---

## 11. Send Location Flow (Integration with Existing Send Flow)

```
1. User picks location/venue in LocationPickerScreen
2. Build plaintext JSON:
   - LOCATION: { "type": "location", "latitude": 41.2995, "longitude": 69.2401, "horizontalAccuracy": 15.5 }
   - VENUE:    { "type": "venue", "latitude": 41.2995, "longitude": 69.2401, "title": "Broadway", "address": "Sayilgoh St", "googlePlaceId": "ChIJ...", "googlePlaceType": "restaurant" }
3. Follow existing Send Message Flow (steps 2-10 in mobile-app-spec.md):
   - Generate idempotencyKey
   - Set contentType: "LOCATION" or "VENUE"
   - Encrypt plaintext for each device
   - POST /messages with { contentType, envelopes }
4. Save to local DB with latitude, longitude, venueTitle, etc.
5. Render as location_bubble in chat UI
```

---

## 12. Receive Location Flow

```
1. Socket receives message.new / PendingPoller fetches envelope
2. Decrypt ciphertext → plaintext JSON
3. Parse plaintext:
   - If type == "location": extract latitude, longitude, horizontalAccuracy
   - If type == "venue": extract latitude, longitude, title, address, googlePlaceId, googlePlaceType
4. Save to local DB with contentType + location fields
5. Render as location_bubble in chat UI
6. Update thread lastMessagePreview: "📍 Location" or "📍 {title}"
```

---

## 13. Notification Preview

Push notifications are silent wakeups (server sends `{ data: { type: "new_message" } }`). The client decrypts the message and builds the local notification:

| contentType | Notification body |
|-------------|------------------|
| `TEXT` | Message text |
| `LOCATION` | `📍 Location` |
| `VENUE` | `📍 {venueTitle}` |

No server-side changes needed.

---

## 14. Mobile Spec Sections to Update

| Section | File | Change |
|---------|------|--------|
| **3. Data Models** | `docs/mobile-app-spec.md:192-215` | Add location fields to `Message` freezed class |
| **7. Local Database** | `docs/mobile-app-spec.md:970-1002` | Add 7 location columns to `messages` table |
| **9. Flows — Send** | `docs/mobile-app-spec.md:1162-1185` | Already mentions LOCATION/VENUE — no change needed |
| **13. pubspec.yaml** | `docs/mobile-app-spec.md:1382-1416` | Add `flutter_map`, `latlong2`, `geolocator`, `map_launcher` |
| **File structure** | `docs/mobile-app-spec.md:60-136` | Add `location/` dir, `location_picker_screen.dart`, `location_bubble.dart` |
| **16. Build Order** | `docs/mobile-app-spec.md:1438-1450` | Add location to Phase 7 (Chat) or new Phase 7b |

---

## 15. Files Changed Summary

| # | File | Change |
|---|------|--------|
| 1 | `docs/mobile-app-spec.md` | Update Message model, Drift schema, pubspec, file tree, build order |
| 2 | `docs/plans/location-sharing.md` | **NEW** — this file |

**When the Flutter app is built, these files will be created:**

| # | File | Purpose |
|---|------|---------|
| 3 | `lib/core/models/location_data.dart` | `LocationData` + `VenueData` freezed models |
| 4 | `lib/core/location/map_tile_service.dart` | OSM tile URL builder |
| 5 | `lib/core/location/poi_search_service.dart` | Nominatim API client |
| 6 | `lib/features/chat/widgets/location_picker_screen.dart` | Full-screen map + search + send |
| 7 | `lib/features/chat/widgets/location_bubble.dart` | Map thumbnail in message list |
| 8 | `lib/features/chat/widgets/poi_search_panel.dart` | Search overlay in picker |
| 9 | `lib/features/chat/providers/location_provider.dart` | GPS position + POI search Riverpod providers |

---

## 16. Implementation Order

1. **Plan doc** ← this file
2. **Update mobile-app-spec.md** — Message model, Drift schema, pubspec, file tree
3. **When building Flutter app:**
   a. `location_data.dart` — freezed models
   b. `map_tile_service.dart` — OSM tile URLs
   c. `poi_search_service.dart` — Nominatim client
   d. `location_provider.dart` — Riverpod providers for GPS + POI
   e. `location_picker_screen.dart` — picker UI
   f. `location_bubble.dart` — message bubble rendering
   g. Wire into send/receive flows
   h. Update thread list preview logic
   i. Add notification preview logic

---

## 17. Testing Plan

### Widget Tests
- `location_bubble.dart`: renders map thumbnail for LOCATION message
- `location_bubble.dart`: renders title + address + map for VENUE message
- `location_picker_screen.dart`: shows "Send Current Location" button
- `location_picker_screen.dart`: shows nearby places list

### Unit Tests
- `poi_search_service.dart`: parses Nominatim response into `VenueData` list
- `poi_search_service.dart`: rate limits to 1 req/sec
- `location_provider.dart`: builds correct plaintext JSON for LOCATION
- `location_provider.dart`: builds correct plaintext JSON for VENUE
- Message preview: returns `📍 Location` for LOCATION contentType
- Message preview: returns `📍 {title}` for VENUE contentType

### Integration Tests
- Send LOCATION message → encrypt → POST → receive → decrypt → render bubble
- Send VENUE message → encrypt → POST → receive → decrypt → render bubble with title

---

## 18. Risks & Notes

- **Nominatim coverage in Central Asia** — OSM data in Uzbekistan is less complete than Google Maps. If POI results are poor, the user can still send their current GPS position (which is always accurate). Google Places can be added later as a fallback provider behind the same `PoiSearchService` interface.
- **Map tile quality** — OSM tiles are functional but not as polished as Mapbox. Acceptable for MVP. Mapbox Static Images API can be swapped in later (just change the tile URL builder in `map_tile_service.dart`).
- **Location permission** — iOS requires `NSLocationWhenInUseUsageDescription` in Info.plist. Android requires `ACCESS_FINE_LOCATION` in AndroidManifest.xml. Add to iOS/Android specifics in the spec.
- **Battery** — we only request GPS position once per send (not continuous). No battery impact beyond the single fix.
- **Accuracy** — `horizontalAccuracy` is optional. If GPS is unavailable (indoor, no signal), the user can still pick a venue from search (no accuracy needed).
- **No live location** — explicitly out of scope. No `live_period`, heading, or proximity alerts.
