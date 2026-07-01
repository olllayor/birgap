# BirGap Admin Panel - Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER / USER                              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ HTTP/HTTPS
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   ADMIN PANEL FRONTEND (Next.js)                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   Dashboard  │  │   Reports    │  │   Users      │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Analytics   │  │  Audit Log   │  │   Login      │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                       │
│         ▼ React Components + Tailwind CSS + Lucide Icons             │
│                                                                       │
│  ┌───────────────────────────────────────────────────────┐          │
│  │           React Query (Data Management)                │          │
│  ├───────────────────────────────────────────────────────┤          │
│  │  • Caching & Revalidation                             │          │
│  │  • Pagination & Filtering                             │          │
│  │  • Error Handling & Retries                           │          │
│  │  • Background Refetching                              │          │
│  └───────────────────────────────────────────────────────┘          │
│                                                                       │
│  ┌───────────────────────────────────────────────────────┐          │
│  │           API Client Layer (lib/api.ts)               │          │
│  ├───────────────────────────────────────────────────────┤          │
│  │  • JWT Token Management                               │          │
│  │  • Request/Response Handling                          │          │
│  │  • Error Processing                                   │          │
│  │  • Automatic Retry Logic                              │          │
│  └───────────────────────────────────────────────────────┘          │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ REST API (Bearer Token)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│              BIRGAP BACKEND (NestJS + PostgreSQL)                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   Auth       │  │  Reports     │  │   Users      │               │
│  │  Controller  │  │  Controller  │  │  Controller  │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │  Analytics   │  │  Audit Log   │  │  Middleware  │               │
│  │  Service     │  │  Service     │  │  (Auth/Role) │               │
│  └──────────────┘  └──────────────┘  └──────────────┘               │
│                                                                       │
│                            ▼ Prisma ORM                             │
│                                                                       │
│  ┌─────────────────────────────────────────────────────┐            │
│  │           PostgreSQL Database                       │            │
│  ├─────────────────────────────────────────────────────┤            │
│  │  • Reports (with reason & status)                   │            │
│  │  • Users (with role & strike count)                 │            │
│  │  • AdminAuditLog (all actions tracked)              │            │
│  │  • DailyMetric (pre-aggregated analytics)           │            │
│  └─────────────────────────────────────────────────────┘            │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Authentication Flow
```
User Input (Email/Password)
        ↓
Login Form (app/login/page.tsx)
        ↓
API Client: POST /api/auth/admin-login
        ↓
Backend: Verify credentials & generate JWT
        ↓
Store token in localStorage
        ↓
Redirect to /admin
        ↓
Token included in all subsequent requests
```

### 2. Reports Management Flow
```
User clicks "Reports" tab
        ↓
useReports() hook fetches data
        ↓
React Query caches results
        ↓
Display reports table with pagination
        ↓
User selects a report
        ↓
useReport() fetches details
        ↓
Display detailed report view
        ↓
User submits review/dismiss action
        ↓
useReviewReport() mutation executes
        ↓
Backend updates report status
        ↓
React Query invalidates reports cache
        ↓
UI updates with fresh data
```

### 3. User Management Flow
```
User searches for username
        ↓
useUsers() hook fetches with search query
        ↓
Display filtered user list
        ↓
User clicks "Manage" button
        ↓
useUser() fetches detailed user info
        ↓
Display user detail page
        ↓
Admin performs action:
  • useChangeUserRole() - Change role
  • useSuspendUser() - Suspend user
  • useUnsuspendUser() - Unsuspend user
  • useResetUserStrikes() - Reset strikes
        ↓
Backend validates & executes action
        ↓
AdminAuditLog records action
        ↓
React Query updates cache
        ↓
UI reflects changes
```

### 4. Analytics Flow
```
User selects metric (DAU, Messages, etc.)
        ↓
useAnalytics() hook fetches data
        ↓
User selects time range (7/30/90 days)
        ↓
Query parameter updated
        ↓
Backend aggregates data from DailyMetric table
        ↓
Recharts renders visualization
        ↓
User can export as CSV
        ↓
Download CSV file to device
```

## Component Hierarchy

```
RootLayout
├── page (redirect logic)
├── login/page
│   ├── LoginForm
│   └── API calls
└── admin/layout (Admin wrapper)
    ├── Sidebar (Navigation)
    └── MainContent
        ├── Dashboard (/admin/page)
        │   ├── MetricCards
        │   ├── AnalyticsChart
        │   └── RecentReports
        │
        ├── Reports (/admin/reports/page)
        │   ├── FilterBar
        │   ├── ReportsTable
        │   └── ReportDetail (modal/detail page)
        │
        ├── Users (/admin/users/page)
        │   ├── SearchBar
        │   ├── FilterSelects
        │   ├── UsersTable
        │   └── UserDetail (detail page)
        │
        ├── Analytics (/admin/analytics/page)
        │   ├── ControlPanel
        │   ├── Chart (Recharts)
        │   └── StatsTable
        │
        └── AuditLog (/admin/audit-log/page)
            ├── FilterButtons
            └── AuditTable (expandable rows)
```

## State Management

### React Query Configuration
```typescript
QueryClient {
  defaultOptions: {
    queries: {
      retry: 1,                    // Retry failed requests once
      refetchOnWindowFocus: false, // Don't refetch on window focus
      staleTime: 30000,            // Consider data fresh for 30s
      gcTime: 300000,              // Keep cached data for 5m
    }
  }
}
```

### Hooks Pattern
```
useReports()
├── queryKey: ['reports', page, status]
├── staleTime: 30s
└── Returns: { data, isLoading, error }

useReviewReport()
├── mutationFn: POST /admin/reports/:id/review
├── onSuccess: invalidate reports cache
└── Returns: { mutate, isPending, error }
```

## API Endpoints

### Authentication (1)
```
POST /api/auth/admin-login
→ { accessToken: string }
```

### Reports (4)
```
GET  /api/admin/reports?page=1&status=OPEN
→ { data: Report[], pagination }

GET  /api/admin/reports/:id
→ { id, reason, status, message, ... }

POST /api/admin/reports/:id/review
→ { success: true }

POST /api/admin/reports/:id/dismiss
→ { success: true }
```

### Users (6)
```
GET  /api/admin/users?page=1&search=query&role=ADMIN
→ { data: User[], pagination }

GET  /api/admin/users/:id
→ { id, username, role, status, strikeCount, ... }

POST /api/admin/users/:id/suspend
→ { success: true }

POST /api/admin/users/:id/unsuspend
→ { success: true }

POST /api/admin/users/:id/role
→ { success: true }

POST /api/admin/users/:id/reset-strikes
→ { success: true }
```

### Analytics (1)
```
GET  /api/admin/analytics?metricKind=DAU&days=30
→ { kind, data: [{ date, value }] }
```

### Audit Log (1)
```
GET  /api/admin/audit-log?page=1&action=USER_SUSPEND
→ { data: AuditEntry[], pagination }
```

## Error Handling Strategy

```
API Request
    ↓
Response OK?
├─ YES → Parse JSON → Return data
└─ NO  → Check status code
        ├─ 401 Unauthorized → Clear token, redirect to /login
        ├─ 403 Forbidden → Show "Access Denied" error
        ├─ 404 Not Found → Show "Resource not found" error
        ├─ 5xx Server Error → Show "Server error, try again" message
        └─ Other → Show generic error message
    ↓
React Query retry logic
    ├─ Transient error? → Retry once
    └─ Persistent error? → Show error UI
    ↓
User sees error message or UI indicator
```

## Performance Optimizations

1. **Code Splitting**: Each route loaded separately
2. **Lazy Loading**: Components split by route
3. **Caching**: React Query handles data caching
4. **Pagination**: Large datasets paginated (10-20 per page)
5. **Compression**: CSS and JS automatically minified
6. **Image Optimization**: Lucide icons are lightweight SVGs
7. **Font Optimization**: Geist font loaded via next/font
8. **API Caching**: 30-60 second stale times

## Security Implementation

```
Frontend Security:
├─ JWT Token in localStorage
├─ Bearer token in API headers
├─ Automatic logout on 401
├─ Form validation before submit
├─ XSS protection via React
└─ CSRF protection via SameSite cookies

Backend Security:
├─ JWT verification
├─ Role-based access control
├─ Input validation & sanitization
├─ SQL injection prevention (Prisma)
├─ Audit logging for all actions
└─ Rate limiting on endpoints
```

## Deployment Architecture

```
Development:
admin-frontend (localhost:3001) → Backend (localhost:3000)

Production:
Vercel CDN (admin.birgap.com)
    ├─ Edge Functions (SSR)
    ├─ Static Assets (images, CSS, JS)
    └─ API Calls → Backend (api.birgap.com)
```

## Database Schema Integration

The admin panel works with these backend database models:

```prisma
// Reports
model Report {
  id String @id
  reportedById String
  messageId String
  reason ReportReason
  status ReportStatus
  message String
  createdAt DateTime
}

// Users
model User {
  id String @id
  username String
  phone String
  role UserRole
  status UserStatus
  strikeCount Int
  createdAt DateTime
  updatedAt DateTime
}

// Audit Log
model AdminAuditLog {
  id String @id
  action String
  targetType String
  targetId String?
  actorId String
  metadata Json
  createdAt DateTime
}

// Analytics
model DailyMetric {
  id String @id
  date DateTime
  kind MetricKind
  value Int
  dimension String?
}
```

## Browser Support

- Chrome/Edge: Latest 2 versions
- Firefox: Latest 2 versions
- Safari: Latest 2 versions
- Mobile: iOS Safari 12+, Chrome Mobile

## Development Workflow

```
1. Make changes in VSCode
2. Save file → Next.js HMR reloads component
3. Browser shows changes in real-time
4. React Query DevTools available in development
5. Console shows any errors/warnings
6. Build production version for deployment
```

This architecture is designed for scalability, maintainability, and user experience.
