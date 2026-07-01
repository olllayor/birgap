'use client'

import {
  useUsers,
  useSuspendUser,
  useUnsuspendUser,
  useChangeUserRole,
  useResetUserStrikes,
} from '@/lib/hooks'
import { useState } from 'react'
import { formatDate, getRoleColor, getStatusColor } from '@/lib/utils'
import { Loader, ChevronLeft, Shield, RotateCcw } from 'lucide-react'
import { AdminUser } from '@/lib/api'

export default function UsersPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>()
  const [statusFilter, setStatusFilter] = useState<string>()
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [newRole, setNewRole] = useState<'USER' | 'MODERATOR' | 'ADMIN'>('USER')

  const { data, isLoading } = useUsers(page, search, roleFilter, statusFilter)
  const suspendMutation = useSuspendUser()
  const unsuspendMutation = useUnsuspendUser()
  const changeRoleMutation = useChangeUserRole()
  const resetStrikesMutation = useResetUserStrikes()

  const handleSuspend = async () => {
    if (!selectedUser) return
    await suspendMutation.mutateAsync({
      userId: selectedUser.id,
      reason: actionReason,
    })
    setSelectedUser(null)
    setActionReason('')
  }

  const handleUnsuspend = async () => {
    if (!selectedUser) return
    await unsuspendMutation.mutateAsync(selectedUser.id)
    setSelectedUser(null)
  }

  const handleChangeRole = async () => {
    if (!selectedUser) return
    await changeRoleMutation.mutateAsync({
      userId: selectedUser.id,
      role: newRole,
    })
    setSelectedUser(null)
  }

  const handleResetStrikes = async () => {
    if (!selectedUser) return
    await resetStrikesMutation.mutateAsync(selectedUser.id)
    setSelectedUser(null)
  }

  if (selectedUser) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedUser(null)}
          className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
        >
          <ChevronLeft size={20} />
          Back to Users
        </button>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="space-y-6">
            {/* User Header */}
            <div className="pb-6 border-b border-border">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">
                    {selectedUser.username}
                  </h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    Phone: {selectedUser.phone}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    ID: {selectedUser.id}
                  </p>
                </div>
                <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${getStatusColor(selectedUser.status)}`}>
                  {selectedUser.status}
                </span>
              </div>
            </div>

            {/* User Info Grid */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Role
                </h3>
                <span className={`inline-block text-sm font-semibold px-3 py-1 rounded-full border mt-2 ${getRoleColor(selectedUser.role)}`}>
                  {selectedUser.role}
                </span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Strike Count
                </h3>
                <p className="text-2xl font-bold text-foreground mt-2">
                  {selectedUser.strikeCount}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Joined
                </h3>
                <p className="text-foreground mt-2">
                  {formatDate(selectedUser.createdAt)}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Last Updated
                </h3>
                <p className="text-foreground mt-2">
                  {formatDate(selectedUser.updatedAt)}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-4 pt-6 border-t border-border">
              <h3 className="text-lg font-semibold text-foreground">Actions</h3>

              {/* Role Management */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Change Role
                </label>
                <div className="flex gap-2">
                  <select
                    value={newRole}
                    onChange={(e) =>
                      setNewRole(e.target.value as 'USER' | 'MODERATOR' | 'ADMIN')
                    }
                    className="flex-1 p-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                  >
                    <option value="USER">User</option>
                    <option value="MODERATOR">Moderator</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <button
                    onClick={handleChangeRole}
                    disabled={changeRoleMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {changeRoleMutation.isPending ? (
                      <Loader size={16} className="animate-spin" />
                    ) : (
                      <Shield size={16} />
                    )}
                    Change
                  </button>
                </div>
              </div>

              {/* Strikes Management */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Strike Count: {selectedUser.strikeCount}
                </label>
                <button
                  onClick={handleResetStrikes}
                  disabled={resetStrikesMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
                >
                  {resetStrikesMutation.isPending ? (
                    <Loader size={16} className="animate-spin" />
                  ) : (
                    <RotateCcw size={16} />
                  )}
                  Reset Strikes
                </button>
              </div>

              {/* Suspend/Unsuspend */}
              {selectedUser.status === 'ACTIVE' ? (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Suspend User
                  </label>
                  <textarea
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    className="w-full p-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary mb-2"
                    rows={2}
                    placeholder="Reason for suspension..."
                  />
                  <button
                    onClick={handleSuspend}
                    disabled={suspendMutation.isPending}
                    className="w-full px-4 py-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-50"
                  >
                    {suspendMutation.isPending ? (
                      <Loader size={16} className="animate-spin inline" />
                    ) : (
                      'Suspend User'
                    )}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleUnsuspend}
                  disabled={unsuspendMutation.isPending}
                  className="w-full px-4 py-2 bg-success text-success-foreground rounded-lg hover:bg-success/90 transition-colors disabled:opacity-50"
                >
                  {unsuspendMutation.isPending ? (
                    <Loader size={16} className="animate-spin inline" />
                  ) : (
                    'Unsuspend User'
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Users</h1>
        <p className="text-muted-foreground mt-2">
          Search and manage user accounts
        </p>
      </div>

      {/* Search and Filters */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <input
          type="text"
          placeholder="Search by username or phone..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="w-full p-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
        />
        <div className="flex gap-2 flex-wrap">
          <select
            value={roleFilter || ''}
            onChange={(e) => {
              setRoleFilter(e.target.value || undefined)
              setPage(1)
            }}
            className="px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
          >
            <option value="">All Roles</option>
            <option value="USER">User</option>
            <option value="MODERATOR">Moderator</option>
            <option value="ADMIN">Admin</option>
          </select>
          <select
            value={statusFilter || ''}
            onChange={(e) => {
              setStatusFilter(e.target.value || undefined)
              setPage(1)
            }}
            className="px-3 py-2 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
          >
            <option value="">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader className="animate-spin" size={32} />
          </div>
        ) : data?.data && data.data.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Username
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Role
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Strikes
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Joined
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-border hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-6 py-4 text-foreground font-medium">
                        {user.username}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-2 py-1 rounded border ${getRoleColor(user.role)}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-2 py-1 rounded border ${getStatusColor(user.status)}`}>
                          {user.status}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-foreground">
                          {user.strikeCount}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="text-primary hover:text-primary/80 text-sm font-medium transition-colors"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.pagination && data.pagination.total > 10 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-border">
                <span className="text-sm text-muted-foreground">
                  Page {page} of {Math.ceil(data.pagination.total / 10)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1 rounded-lg border border-border text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPage((p) => p + 1)}
                    disabled={!data.pagination.hasMore}
                    className="px-3 py-1 rounded-lg border border-border text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            No users found
          </div>
        )}
      </div>
    </div>
  )
}
