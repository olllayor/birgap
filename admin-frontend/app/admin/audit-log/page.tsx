'use client'

import { useAuditLog } from '@/lib/hooks'
import { useState } from 'react'
import { formatDateTime, formatTimeAgo } from '@/lib/utils'
import { Loader, ChevronDown, ChevronUp } from 'lucide-react'
import { AuditLogEntry } from '@/lib/api'

const ACTION_COLORS: Record<string, string> = {
  MESSAGE_TOMBSTONE: 'bg-red-900/20 text-red-100 border-red-800',
  USER_SUSPEND: 'bg-red-900/20 text-red-100 border-red-800',
  ROLE_PROMOTE: 'bg-blue-900/20 text-blue-100 border-blue-800',
  ROLE_DEMOTE: 'bg-yellow-900/20 text-yellow-100 border-yellow-800',
  STRIKE_RESET: 'bg-green-900/20 text-green-100 border-green-800',
  REPORT_REVIEW: 'bg-purple-900/20 text-purple-100 border-purple-800',
}

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [filterAction, setFilterAction] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useAuditLog(page, filterAction ? { action: filterAction } : {})

  const actions = [...new Set(data?.data?.map((entry) => entry.action) || [])]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Audit Log</h1>
        <p className="text-muted-foreground mt-2">
          Track all admin actions and system events
        </p>
      </div>

      {/* Filters */}
      <div className="bg-card border border-border rounded-lg p-4">
        <label className="block text-sm font-medium text-foreground mb-2">
          Filter by Action
        </label>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => {
              setFilterAction('')
              setPage(1)
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              !filterAction
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            All
          </button>
          {actions.map((action) => (
            <button
              key={action}
              onClick={() => {
                setFilterAction(action)
                setPage(1)
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filterAction === action
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {action}
            </button>
          ))}
        </div>
      </div>

      {/* Audit Entries */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader className="animate-spin" size={32} />
          </div>
        ) : data?.data && data.data.length > 0 ? (
          <div className="space-y-1">
            {data.data.map((entry) => (
              <div key={entry.id}>
                <button
                  onClick={() =>
                    setExpandedId(expandedId === entry.id ? null : entry.id)
                  }
                  className="w-full px-6 py-4 hover:bg-muted/20 transition-colors border-b border-border text-left flex items-center justify-between group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded border ${
                          ACTION_COLORS[entry.action] ||
                          'bg-slate-900/20 text-slate-100 border-slate-800'
                        }`}
                      >
                        {entry.action}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {entry.actor?.username || 'Unknown'}
                      </span>
                      {entry.targetId && (
                        <span className="text-sm text-muted-foreground">
                          on {entry.targetType}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {formatTimeAgo(entry.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="ml-4">
                    {expandedId === entry.id ? (
                      <ChevronUp size={18} className="text-muted-foreground" />
                    ) : (
                      <ChevronDown size={18} className="text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Expanded Details */}
                {expandedId === entry.id && (
                  <div className="px-6 py-4 bg-muted/10 border-b border-border space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                          Actor
                        </h4>
                        <p className="text-sm text-foreground mt-1 break-all">
                          {entry.actor?.username || entry.actorId}
                        </p>
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                          Timestamp
                        </h4>
                        <p className="text-sm text-foreground mt-1">
                          {formatDateTime(entry.createdAt)}
                        </p>
                      </div>
                      {entry.targetId && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                            Target Type
                          </h4>
                          <p className="text-sm text-foreground mt-1">
                            {entry.targetType}
                          </p>
                        </div>
                      )}
                      {entry.targetId && (
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                            Target ID
                          </h4>
                          <p className="text-sm text-foreground mt-1 break-all font-mono">
                            {entry.targetId}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Metadata */}
                    {Object.keys(entry.metadata).length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                          Details
                        </h4>
                        <div className="mt-2 p-3 bg-input border border-border rounded-lg overflow-auto">
                          <pre className="text-xs text-muted-foreground">
                            {JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            No audit entries found
          </div>
        )}
      </div>

      {/* Pagination */}
      {data?.pagination && data.pagination.total > 20 && (
        <div className="flex items-center justify-between px-6 py-4 bg-card border border-border rounded-lg">
          <span className="text-sm text-muted-foreground">
            Page {page} of {Math.ceil(data.pagination.total / 20)}
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
    </div>
  )
}
