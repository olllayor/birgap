'use client'

import { useReports, useReviewReport } from '@/lib/hooks'
import { useState } from 'react'
import { formatDate, getStatusColor, getReasonColor } from '@/lib/utils'
import { Loader, ChevronLeft, Check, X } from 'lucide-react'
import { Report } from '@/lib/api'

export default function ReportsPage() {
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string>()
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [actionReason, setActionReason] = useState('')

  const { data, isLoading } = useReports(page, statusFilter)
  const reviewMutation = useReviewReport()

  const handleReview = async (reportId: string, action: 'review' | 'dismiss') => {
    await reviewMutation.mutateAsync({
      reportId,
      action,
      reason: actionReason,
    })
    setSelectedReport(null)
    setActionReason('')
  }

  if (selectedReport) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedReport(null)}
          className="flex items-center gap-2 text-primary hover:text-primary/80 transition-colors"
        >
          <ChevronLeft size={20} />
          Back to Reports
        </button>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="space-y-4">
            {/* Report Header */}
            <div className="pb-4 border-b border-border">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">
                    Report Details
                  </h2>
                  <p className="text-muted-foreground text-sm mt-1">
                    ID: {selectedReport.id}
                  </p>
                </div>
                <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${getStatusColor(selectedReport.status)}`}>
                  {selectedReport.status}
                </span>
              </div>
            </div>

            {/* Report Info */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Reported User
                </h3>
                <p className="text-lg font-medium text-foreground mt-2">
                  {selectedReport.reportedUser.username}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Report Reason
                </h3>
                <span className={`inline-block text-sm font-semibold px-3 py-1 rounded-full border mt-2 ${getReasonColor(selectedReport.reason)}`}>
                  {selectedReport.reason}
                </span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Reported At
                </h3>
                <p className="text-foreground mt-2">
                  {formatDate(selectedReport.createdAt)}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Message ID
                </h3>
                <p className="text-foreground mt-2 break-all font-mono text-sm">
                  {selectedReport.messageId}
                </p>
              </div>
            </div>

            {/* Message Content */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Message Content
              </h3>
              <div className="mt-3 p-4 bg-muted/20 border border-border rounded-lg">
                <p className="text-foreground whitespace-pre-wrap break-words">
                  {selectedReport.message || 'No content available'}
                </p>
              </div>
            </div>

            {/* Action */}
            {selectedReport.status !== 'CLOSED' && (
              <div className="space-y-4 pt-6 border-t border-border">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Action Reason (optional)
                  </label>
                  <textarea
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    className="w-full p-3 bg-input border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
                    rows={3}
                    placeholder="Enter reason for your action..."
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleReview(selectedReport.id, 'review')}
                    disabled={reviewMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {reviewMutation.isPending ? (
                      <Loader size={18} className="animate-spin" />
                    ) : (
                      <Check size={18} />
                    )}
                    Mark as Reviewed
                  </button>
                  <button
                    onClick={() => handleReview(selectedReport.id, 'dismiss')}
                    disabled={reviewMutation.isPending}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors disabled:opacity-50"
                  >
                    {reviewMutation.isPending ? (
                      <Loader size={18} className="animate-spin" />
                    ) : (
                      <X size={18} />
                    )}
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Reports</h1>
        <p className="text-muted-foreground mt-2">
          Manage user reports and take moderation actions
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => {
            setStatusFilter(undefined)
            setPage(1)
          }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            !statusFilter
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          All
        </button>
        {['OPEN', 'IN_REVIEW', 'CLOSED'].map((status) => (
          <button
            key={status}
            onClick={() => {
              setStatusFilter(status)
              setPage(1)
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === status
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Reports Table */}
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
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Reason
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((report) => (
                    <tr
                      key={report.id}
                      className="border-b border-border hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-6 py-4 text-foreground">
                        {report.reportedUser.username}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-2 py-1 rounded border ${getReasonColor(report.reason)}`}>
                          {report.reason}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-2 py-1 rounded border ${getStatusColor(report.status)}`}>
                          {report.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {formatDate(report.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => setSelectedReport(report)}
                          className="text-primary hover:text-primary/80 text-sm font-medium transition-colors"
                        >
                          View
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
            No reports found
          </div>
        )}
      </div>
    </div>
  )
}
