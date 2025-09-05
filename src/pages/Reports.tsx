import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { apiCall } from '../utils/api'

interface KPIMetrics {
  timeToDetect: number
  timeToTriage: number
  timeToPrioritize: number
  timeToRemediate: number
  timeToValidate: number
  timeToClose: number
  slaHitRate: number
  totalFindings: number
}

interface CompanyKPIs {
  companyId: string
  companyName: string
  companySlug: string
  kpis: KPIMetrics
}

interface TrendData {
  month: string
  totalFindings: number
  avgTimeToClose: number
  slaHitRate: number
}

interface ReportsData {
  overall: KPIMetrics
  companies: CompanyKPIs[]
  trends: TrendData[]
  slaConfiguration: Record<string, number>
}

const formatDays = (days: number) => {
  if (days === 0) return '0 days'
  if (days < 1) return `${Math.round(days * 24)}h`
  return `${Math.round(days)} days`
}

const formatPercentage = (value: number) => `${Math.round(value)}%`

const getSLAStatusColor = (hitRate: number) => {
  if (hitRate >= 90) return 'text-green-600 bg-green-100'
  if (hitRate >= 70) return 'text-yellow-600 bg-yellow-100'
  return 'text-red-600 bg-red-100'
}

export default function Reports() {
  const { tenant } = useAuth()
  const [reportsData, setReportsData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  })

  const fetchReports = async () => {
    if (!tenant) return
    
    try {
      setLoading(true)
      setError(null)
      
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      })
      
      if (selectedCompany) {
        params.append('companyId', selectedCompany)
      }
      
      const data = await apiCall(`/api/t/${tenant.slug}/reports?${params}`)
      setReportsData(data)
    } catch (err) {
      console.error('Failed to fetch reports:', err)
      setError('Failed to load reports data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchReports()
  }, [tenant, dateRange, selectedCompany])

  if (!tenant) {
    return <div className="p-6">No tenant selected</div>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    )
  }

  if (!reportsData) {
    return <div className="p-6">No reports data available</div>
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Security Reports</h1>
          <p className="mt-1 text-sm text-gray-500">
            Time-to-remediation KPIs and SLA performance metrics
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Start Date</label>
            <input
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">End Date</label>
            <input
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Company</label>
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            >
              <option value="">All Companies</option>
              {reportsData.companies.map(company => (
                <option key={company.companyId} value={company.companyId}>
                  {company.companyName}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Overall KPIs */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-6">
          {selectedCompany 
            ? `KPIs for ${reportsData.companies.find(c => c.companyId === selectedCompany)?.companyName}` 
            : 'Overall KPIs'}
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-gray-500">Time to Triage</h4>
            <p className="text-2xl font-bold text-gray-900">{formatDays(reportsData.overall.timeToTriage)}</p>
            <p className="text-xs text-gray-600">Avg time to assess & assign</p>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-gray-500">Time to Prioritize</h4>
            <p className="text-2xl font-bold text-gray-900">{formatDays(reportsData.overall.timeToPrioritize)}</p>
            <p className="text-xs text-gray-600">Avg time to business context</p>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-gray-500">Time to Remediate</h4>
            <p className="text-2xl font-bold text-gray-900">{formatDays(reportsData.overall.timeToRemediate)}</p>
            <p className="text-xs text-gray-600">Avg time to fix issue</p>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-gray-500">Time to Close</h4>
            <p className="text-2xl font-bold text-gray-900">{formatDays(reportsData.overall.timeToClose)}</p>
            <p className="text-xs text-gray-600">End-to-end cycle time</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-gray-500">Time to Validate</h4>
            <p className="text-2xl font-bold text-gray-900">{formatDays(reportsData.overall.timeToValidate)}</p>
            <p className="text-xs text-gray-600">Avg time to verify fixes</p>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-gray-500">SLA Hit Rate</h4>
            <p className={`text-2xl font-bold ${getSLAStatusColor(reportsData.overall.slaHitRate).split(' ')[0]}`}>
              {formatPercentage(reportsData.overall.slaHitRate)}
            </p>
            <p className="text-xs text-gray-600">Within SLA targets</p>
          </div>
          
          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="text-sm font-medium text-gray-500">Total Findings</h4>
            <p className="text-2xl font-bold text-gray-900">{reportsData.overall.totalFindings}</p>
            <p className="text-xs text-gray-600">In selected period</p>
          </div>
        </div>
      </div>

      {/* SLA Configuration */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">SLA Targets</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(reportsData.slaConfiguration).map(([severity, days]) => (
            <div key={severity} className="text-center">
              <div className={`inline-block px-3 py-1 rounded-full text-xs font-medium mb-2 ${
                severity === 'critical' ? 'bg-red-100 text-red-800' :
                severity === 'high' ? 'bg-orange-100 text-orange-800' :
                severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                'bg-blue-100 text-blue-800'
              }`}>
                {severity.toUpperCase()}
              </div>
              <p className="text-lg font-semibold">{days} days</p>
            </div>
          ))}
        </div>
      </div>

      {/* Company Breakdown */}
      {!selectedCompany && reportsData.companies.length > 0 && (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-6">Company Performance</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Findings</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Time to Close</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">SLA Hit Rate</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time to Remediate</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {reportsData.companies.map(company => (
                  <tr key={company.companyId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => setSelectedCompany(company.companyId)}
                        className="text-indigo-600 hover:text-indigo-900 font-medium"
                      >
                        {company.companyName}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {company.kpis.totalFindings}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDays(company.kpis.timeToClose)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getSLAStatusColor(company.kpis.slaHitRate)}`}>
                        {formatPercentage(company.kpis.slaHitRate)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDays(company.kpis.timeToRemediate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trend Chart Placeholder */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Performance Trends (Last 12 Months)</h3>
        {reportsData.trends.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Monthly trend data showing findings volume and SLA performance over time.
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Findings</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Avg Time to Close</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SLA Hit Rate</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {reportsData.trends.map((trend, index) => (
                    <tr key={index}>
                      <td className="px-4 py-2 text-sm text-gray-900">
                        {new Date(trend.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-900">{trend.totalFindings}</td>
                      <td className="px-4 py-2 text-sm text-gray-900">
                        {trend.avgTimeToClose ? formatDays(trend.avgTimeToClose) : 'N/A'}
                      </td>
                      <td className="px-4 py-2 text-sm">
                        {trend.slaHitRate ? (
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getSLAStatusColor(trend.slaHitRate)}`}>
                            {formatPercentage(trend.slaHitRate)}
                          </span>
                        ) : (
                          <span className="text-gray-400">N/A</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">No trend data available for the selected period.</p>
        )}
      </div>
    </div>
  )
}