# BirGap Admin Panel - Documentation Index

This is a complete index of all documentation and resources for the BirGap Admin Panel.

## Getting Started

**New to the project?** Start here:

1. **[ADMIN_PANEL_QUICKSTART.md](./ADMIN_PANEL_QUICKSTART.md)** ⚡
   - 5-minute setup guide
   - Installation steps
   - First login instructions
   - Quick troubleshooting

2. **[admin-frontend/README.md](./admin-frontend/README.md)** 📖
   - Complete project documentation
   - Feature overview
   - Tech stack details
   - Project structure
   - Development guide

## Implementation Details

**Want to understand how it works?**

3. **[ADMIN_PANEL_GUIDE.md](./ADMIN_PANEL_GUIDE.md)** 🏗️
   - Full implementation overview
   - What was built
   - Technical architecture
   - File structure explanation
   - API integration details
   - Development workflow

4. **[ADMIN_PANEL_ARCHITECTURE.md](./ADMIN_PANEL_ARCHITECTURE.md)** 🎯
   - System architecture diagrams
   - Data flow explanations
   - Component hierarchy
   - State management patterns
   - API endpoint specifications
   - Error handling strategy
   - Performance optimizations
   - Security implementation

## Reference

5. **[ADMIN_PANEL_SUMMARY.txt](./ADMIN_PANEL_SUMMARY.txt)** 📋
   - Quick visual summary
   - Project statistics
   - Feature checklist
   - Tech stack overview
   - Build checklist

## Project Files

### Configuration Files
```
admin-frontend/
├── package.json              - Dependencies (Next.js, React, Tailwind, etc.)
├── next.config.ts            - Next.js configuration
├── tailwind.config.ts        - Tailwind CSS theme
├── tsconfig.json             - TypeScript settings
├── postcss.config.mjs        - PostCSS configuration
└── .env.local.example        - Environment variables template
```

### Application Code
```
admin-frontend/app/
├── layout.tsx                - Root HTML layout
├── page.tsx                  - Home page (redirect)
├── globals.css               - Global styles & design tokens
├── login/page.tsx            - Login page
└── admin/
    ├── layout.tsx            - Admin layout with sidebar
    ├── page.tsx              - Dashboard page
    ├── reports/page.tsx      - Reports management
    ├── users/page.tsx        - User management
    ├── analytics/page.tsx    - Analytics dashboard
    └── audit-log/page.tsx    - Audit log viewer
```

### Components & Libraries
```
admin-frontend/
├── components/
│   ├── Sidebar.tsx           - Navigation sidebar
│   └── Providers.tsx         - React Query setup
└── lib/
    ├── api.ts                - API client & types
    ├── hooks.ts              - React Query hooks
    └── utils.ts              - Utility functions
```

## Features Overview

### 🎯 Dashboard
- Real-time metrics overview
- Key performance indicators
- Recent activity
- Quick action links

### 📢 Reports Management
- Browse user reports with filters
- Detailed report view with message context
- Review or dismiss reports
- Audit trail of actions

### 👥 User Management
- Search and filter users
- View user profiles
- Change user roles (USER → MODERATOR → ADMIN)
- Suspend/unsuspend users
- Manage strike counts
- Audit trail for all changes

### 📊 Analytics
- 7 different metrics tracked
- Configurable time ranges
- Multiple chart types
- CSV data export
- Statistics tables

### 🔍 Audit Log
- Complete action history
- Filter by action type
- Expandable detailed view
- JSON metadata display
- Pagination support

### 🔐 Authentication
- Secure JWT login
- Token management
- Session handling
- Role-based access

## API Endpoints

The admin panel integrates with these backend endpoints:

### Authentication (1 endpoint)
- `POST /api/auth/admin-login` - Admin login with JWT

### Reports (4 endpoints)
- `GET /api/admin/reports` - List reports with pagination & filters
- `GET /api/admin/reports/:id` - Get report details
- `POST /api/admin/reports/:id/review` - Mark as reviewed
- `POST /api/admin/reports/:id/dismiss` - Dismiss report

### Users (6 endpoints)
- `GET /api/admin/users` - List users with search & filters
- `GET /api/admin/users/:id` - Get user details
- `POST /api/admin/users/:id/suspend` - Suspend user
- `POST /api/admin/users/:id/unsuspend` - Unsuspend user
- `POST /api/admin/users/:id/role` - Change user role
- `POST /api/admin/users/:id/reset-strikes` - Reset strikes

### Analytics (1 endpoint)
- `GET /api/admin/analytics` - Get metrics data

### Audit Log (1 endpoint)
- `GET /api/admin/audit-log` - Get audit entries

## Tech Stack

### Frontend Framework
- **Next.js 16** - React meta-framework with App Router
- **React 18** - UI component library
- **TypeScript 5** - Type safety

### Styling & UI
- **Tailwind CSS v4** - Utility-first CSS
- **Lucide React** - Icon library (350+ icons)
- **Custom Design Tokens** - Dark professional theme

### Data Management
- **React Query v5** - Server state management
- **Axios** - HTTP client (via fetch)

### Visualization
- **Recharts** - React charting library
- **date-fns** - Date utilities

### Development Tools
- **PostCSS** - CSS transformations
- **ESLint** - Code linting
- **TypeScript** - Static typing

## Colors & Design

### Primary Colors
- **Background**: `#0f172a` - Dark slate
- **Foreground**: `#f1f5f9` - Light text
- **Card**: `#1e293b` - Slightly lighter background
- **Primary**: `#3b82f6` - Blue for actions
- **Destructive**: `#ef4444` - Red for warnings
- **Success**: `#10b981` - Green for positive
- **Muted**: `#475569` - Secondary elements

### Typography
- **Font**: Geist (sans-serif)
- **Mono Font**: Geist Mono (monospace)
- **Responsive sizes**: 12px → 32px

## Development Commands

```bash
# Installation
cd admin-frontend
npm install

# Development
npm run dev          # Start dev server (http://localhost:3001)

# Production
npm run build        # Build for production
npm start            # Start production server

# Other
npm run lint         # Run ESLint
```

## Environment Variables

Create `.env.local` file:

```
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

Change `localhost:3000` to your backend URL.

## File Size Reference

- **API Client**: ~170 lines
- **React Query Hooks**: ~139 lines
- **Utilities**: ~56 lines
- **Sidebar Component**: ~103 lines
- **Dashboard Page**: ~212 lines
- **Reports Page**: ~297 lines
- **Users Page**: ~388 lines
- **Analytics Page**: ~244 lines
- **Audit Log Page**: ~217 lines
- **Login Page**: ~112 lines

**Total**: ~2,500+ lines of code

## Deployment

### Development
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm start
```

### Deploy to Vercel
```bash
vercel deploy
```

## Security Features

✓ JWT token authentication
✓ Backend role validation
✓ Secure token storage
✓ Automatic session timeout
✓ CORS protection
✓ Input validation
✓ Error sanitization
✓ Audit logging for all actions

## Common Tasks

### Add a New Page
1. Create `app/admin/[feature]/page.tsx`
2. Add hooks in `lib/hooks.ts` if needed
3. Add API methods in `lib/api.ts`
4. Update sidebar navigation in `components/Sidebar.tsx`

### Add New API Endpoint
1. Define endpoint in `lib/api.ts`
2. Create React Query hook in `lib/hooks.ts`
3. Use hook in component

### Change Styling
1. Update design tokens in `app/globals.css`
2. Use Tailwind classes in components
3. Leverage CSS variables for theming

### Add New Report Type
1. Update `Report` interface in `lib/api.ts`
2. Update reason colors in `lib/utils.ts`
3. Update report list display logic

## Troubleshooting

### Port Already in Use
```bash
npm run dev -- -p 3002
```

### CORS Errors
- Update backend CORS to allow admin origin

### API Connection Failed
- Check backend is running
- Verify `NEXT_PUBLIC_API_URL` is correct

### Charts Not Showing
- Verify analytics data from backend
- Check metric name spelling

### Login Fails
- Verify admin credentials
- Check backend `/api/auth/admin-login` endpoint exists

## Support & Maintenance

- Regular dependency updates recommended
- Monitor bundle size for performance
- Keep Node.js version updated
- Run `npm audit` periodically
- Test all endpoints before deployment

## Related Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
- [React Query](https://tanstack.com/query)
- [Recharts](https://recharts.org)
- [TypeScript](https://www.typescriptlang.org)

## Contact & Support

For issues or questions:
1. Check the troubleshooting section
2. Review documentation files
3. Check browser console for errors
4. Verify backend API endpoints
5. Check `.env.local` configuration

---

**Version**: 1.0  
**Last Updated**: 2026-07-02  
**Status**: Production Ready ✓
