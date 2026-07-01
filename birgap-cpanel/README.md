# BirGap Admin Panel

Professional admin dashboard for BirGap chat messenger, providing comprehensive moderation, user management, analytics, and audit logging capabilities.

## Features

### 📊 Dashboard
- Real-time metrics overview (reports, users, suspensions)
- Analytics visualization with selectable metrics
- Recent reports and activity tracking

### 🚨 Reports Management
- Browse user reports with filtering by status (OPEN, IN_REVIEW, CLOSED)
- Filter by report reason (SPAM, HARASSMENT, HATE_SPEECH, SEXUAL_CONTENT, VIOLENCE, IMPERSONATION, OTHER)
- View detailed report information with message context
- Mark reports as reviewed or dismissed with optional reasoning

### 👥 User Management
- Search users by username or phone number
- Filter by role (USER, MODERATOR, ADMIN) and status (ACTIVE, SUSPENDED)
- View user profiles with detailed information
- Change user roles and permissions
- Suspend/unsuspend users
- Reset strike counts

### 📈 Analytics
- 7 different metric types tracked
- Configurable time ranges (7, 30, 90 days)
- Multiple chart visualization options (Line, Bar)
- Export data as CSV
- Drill-down into detailed statistics

### 🔍 Audit Log
- Comprehensive audit trail of all admin actions
- Filter by action type
- View detailed information about each action
- See actor, timestamp, and metadata
- Cursor-based pagination

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **UI**: React 18 + Tailwind CSS v4
- **Data Fetching**: TanStack React Query
- **Charts**: Recharts
- **Icons**: Lucide React
- **Date Handling**: date-fns
- **Styling**: Tailwind CSS with custom design tokens

## Project Structure

```
admin-frontend/
├── app/
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Redirect to login/admin
│   ├── login/
│   │   └── page.tsx         # Admin login page
│   ├── admin/
│   │   ├── layout.tsx       # Admin layout with sidebar
│   │   ├── page.tsx         # Dashboard
│   │   ├── reports/
│   │   │   └── page.tsx     # Reports management
│   │   ├── users/
│   │   │   └── page.tsx     # User management
│   │   ├── analytics/
│   │   │   └── page.tsx     # Analytics dashboard
│   │   └── audit-log/
│   │       └── page.tsx     # Audit log viewer
│   └── globals.css          # Global styles & design tokens
├── components/
│   ├── Sidebar.tsx          # Navigation sidebar
│   └── Providers.tsx        # React Query provider
├── lib/
│   ├── api.ts               # API client
│   ├── hooks.ts             # React Query hooks
│   └── utils.ts             # Utility functions
├── tailwind.config.ts       # Tailwind configuration
├── tsconfig.json            # TypeScript config
├── next.config.ts           # Next.js config
└── postcss.config.mjs       # PostCSS config
```

## Setup & Installation

### Prerequisites
- Node.js 18+
- npm, pnpm, or yarn

### Installation

1. Navigate to the admin panel directory:
```bash
cd admin-frontend
```

2. Install dependencies:
```bash
npm install
# or
pnpm install
```

3. Create `.env.local` file:
```bash
cp .env.local.example .env.local
```

4. Update `.env.local` with your backend API URL:
```
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

### Development

Start the development server:
```bash
npm run dev
# or
pnpm dev
```

The admin panel will be available at `http://localhost:3001`

### Production Build

Build for production:
```bash
npm run build
npm start
```

## API Integration

The admin panel connects to the BirGap backend API. Ensure the following endpoints are available:

### Authentication
- `POST /api/auth/admin-login` - Admin login

### Reports
- `GET /api/admin/reports` - List reports (with pagination & filters)
- `GET /api/admin/reports/:id` - Get report details
- `POST /api/admin/reports/:id/review` - Mark report as reviewed
- `POST /api/admin/reports/:id/dismiss` - Dismiss report

### Users
- `GET /api/admin/users` - List users (with pagination, search & filters)
- `GET /api/admin/users/:id` - Get user details
- `POST /api/admin/users/:id/suspend` - Suspend user
- `POST /api/admin/users/:id/unsuspend` - Unsuspend user
- `POST /api/admin/users/:id/role` - Change user role
- `POST /api/admin/users/:id/reset-strikes` - Reset strike count

### Analytics
- `GET /api/admin/analytics` - Get metrics data

### Audit Log
- `GET /api/admin/audit-log` - Get audit log entries (with pagination & filters)

All API calls require a valid JWT token in the `Authorization` header:
```
Authorization: Bearer <token>
```

## Authentication

1. **Login Page**: Admins enter credentials at `/login`
2. **Token Storage**: JWT token stored in browser localStorage
3. **Token Refresh**: Tokens are automatically included in API requests
4. **Session Management**: Automatic logout on 401 response
5. **Protected Routes**: Admin routes require valid token

## Design System

### Color Palette
- **Background**: `#0f172a` - Dark slate background
- **Foreground**: `#f1f5f9` - Light text
- **Card**: `#1e293b` - Slightly lighter than background
- **Primary**: `#3b82f6` - Blue for actions
- **Destructive**: `#ef4444` - Red for dangerous actions
- **Success**: `#10b981` - Green for positive actions
- **Muted**: `#475569` - Secondary elements

### Typography
- **Sans Font**: Geist (default)
- **Mono Font**: Geist Mono (for IDs, codes)
- **Heading**: Bold 24-32px
- **Body**: Regular 14-16px
- **Small**: 12-13px for captions

## Responsive Design

- **Mobile**: Full-width, hamburger navigation
- **Tablet**: Adjusted spacing and font sizes
- **Desktop**: Sidebar layout (64px wide)
- **Large**: Optimal for desktop viewing

## Best Practices

1. **Error Handling**: All API errors are caught and displayed to users
2. **Loading States**: Visual feedback during async operations
3. **Pagination**: Efficient data loading with cursor-based pagination
4. **Caching**: React Query handles automatic caching and revalidation
5. **Accessibility**: Semantic HTML, ARIA labels, keyboard navigation

## Troubleshooting

### Login Issues
- Verify backend is running on correct port
- Check `NEXT_PUBLIC_API_URL` environment variable
- Ensure admin credentials are correct

### API Connection Errors
- Verify backend API is accessible
- Check CORS settings if using different domain
- Review browser console for specific errors

### Chart Not Displaying
- Ensure analytics data is available from backend
- Check for correct metric name spelling
- Verify date range has data

## Development Notes

- The admin panel uses React Query for data fetching with automatic caching
- All styling is done with Tailwind CSS using custom design tokens
- Components are built with accessibility in mind
- Error boundaries handle component-level errors gracefully

## Future Enhancements

- Dark/light mode toggle
- Advanced filtering and search
- Bulk user actions
- Custom report templates
- Email notifications for critical events
- Real-time WebSocket updates
- Advanced analytics exports
- Role-based permission management
