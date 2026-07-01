# BirGap Admin Panel - Quick Start

Get the admin panel running in 5 minutes.

## Prerequisites
- Node.js 18+
- Backend running on `http://localhost:3000`
- Admin account created on backend

## Installation

```bash
# Navigate to admin panel
cd admin-frontend

# Install dependencies (choose one)
npm install
# or
pnpm install
# or
yarn install
```

## Configuration

Create `.env.local`:
```bash
cp .env.local.example .env.local
```

Update if your backend is not on `http://localhost:3000`:
```
NEXT_PUBLIC_API_URL=http://your-backend-url/api
```

## Start Development

```bash
npm run dev
```

Visit: `http://localhost:3001`

## Login

Use your admin credentials:
- Email: admin@example.com (or your admin email)
- Password: your-password

## What You Can Do

### Dashboard (`/admin`)
- See real-time metrics
- View open reports
- Access quick actions

### Reports (`/admin/reports`)
- View all user reports
- Filter by status (OPEN, IN_REVIEW, CLOSED)
- Review or dismiss reports
- See message context

### Users (`/admin/users`)
- Search users by username/phone
- Filter by role or status
- Suspend/unsuspend users
- Change roles
- Reset strike counts

### Analytics (`/admin/analytics`)
- View 7 different metrics
- Select time range (7/30/90 days)
- Switch between chart types
- Export data as CSV

### Audit Log (`/admin/audit-log`)
- See all admin actions
- Filter by action type
- View detailed information
- Track who did what and when

## Next Steps

1. **Explore the Dashboard** - Get familiar with the interface
2. **Test Reports** - Try reviewing a report
3. **Manage Users** - Practice role management
4. **Check Analytics** - Explore available metrics
5. **Review Audit Log** - See your actions logged

## Troubleshooting

### Port 3001 already in use?
```bash
npm run dev -- -p 3002
```

### Cannot connect to backend?
- Check backend is running: `http://localhost:3000`
- Verify `NEXT_PUBLIC_API_URL` in `.env.local`
- Check CORS settings on backend

### Login fails?
- Verify admin credentials are correct
- Ensure backend has admin endpoint: `/api/auth/admin-login`
- Check backend logs for errors

### Charts not showing?
- Verify backend has analytics data
- Check date range selection
- Inspect browser console for errors

## Backend Requirements

Ensure your backend has these endpoints:

```
POST   /api/auth/admin-login
GET    /api/admin/reports
GET    /api/admin/reports/:id
POST   /api/admin/reports/:id/review
POST   /api/admin/reports/:id/dismiss
GET    /api/admin/users
GET    /api/admin/users/:id
POST   /api/admin/users/:id/suspend
POST   /api/admin/users/:id/unsuspend
POST   /api/admin/users/:id/role
POST   /api/admin/users/:id/reset-strikes
GET    /api/admin/analytics
GET    /api/admin/audit-log
```

All endpoints require `Authorization: Bearer <token>` header.

## Production Deployment

```bash
# Build for production
npm run build

# Start production server
npm start

# Or deploy to Vercel
vercel deploy
```

## Documentation

For detailed documentation, see:
- `README.md` - Full documentation
- `ADMIN_PANEL_GUIDE.md` - Implementation details

## Support

If you encounter issues:
1. Check the logs (browser console & terminal)
2. Verify backend is running
3. Review error messages carefully
4. Check `.env.local` configuration
5. Ensure all required endpoints exist

---

Happy moderating! 🚀
