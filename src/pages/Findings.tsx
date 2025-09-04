import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import clsx from 'clsx'

const severityColors = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
  info: 'bg-gray-100 text-gray-800'
}

export default function Findings() {
  const { tenant } = useAuth()
  const [selectedSeverity, setSelectedSeverity] = useState<string>('')
  const [selectedCompany, setSelectedCompany] = useState<string>('')

  const { data: findings, isLoading } = useQuery({
    queryKey: ['findings', tenant?.id, selectedSeverity, selectedCompany],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedSeverity) params.append('severity', selectedSeverity)
      if (selectedCompany) params.append('company', selectedCompany)
      
      const res = await fetch(`/api/t/${tenant?.slug}/findings?${params}`)
      if (!res.ok) throw new Error('Failed to fetch findings')
      return res.json()
    },
    enabled: !!tenant
  })

  const { data: companies } = useQuery({
    queryKey: ['companies', tenant?.id],
    queryFn: async () => {
      const res = await fetch(`/api/t/${tenant?.slug}/companies`)
      if (!res.ok) throw new Error('Failed to fetch companies')
      return res.json()
    },
    enabled: !!tenant
  })

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Findings</h1>
        <div className="mt-3 sm:mt-0 sm:ml-4 flex space-x-3">
          <select
            value={selectedSeverity}
            onChange={(e) => setSelectedSeverity(e.target.value)}
            className="block w-full rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
          >
            <option value="">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
          
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="block w-full rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
          >
            <option value="">All Companies</option>
            {companies?.map((company: any) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-6 bg-white shadow overflow-hidden sm:rounded-md">
        {isLoading ? (
          <div className="px-4 py-5 sm:p-6">
            <div className="animate-pulse space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-20 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : findings?.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {findings.map((finding: any) => (
              <li key={finding.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <p className="text-sm font-medium text-indigo-600 truncate">
                          {finding.name}
                        </p>
                        <span className={clsx(
                          'ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          severityColors[finding.severity as keyof typeof severityColors]
                        )}>
                          {finding.severity}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{finding.description}</p>
                      <div className="mt-2 flex items-center text-sm text-gray-500">
                        <span>{finding.company?.name}</span>
                        <span className="mx-2">•</span>
                        <span>{finding.templateId}</span>
                        <span className="mx-2">•</span>
                        <span>{new Date(finding.firstSeen).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="ml-4 flex items-center space-x-2">
                      {finding.externalIssues?.length > 0 && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Linked
                        </span>
                      )}
                      <button className="text-indigo-600 hover:text-indigo-900 text-sm font-medium">
                        Create Issue
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-5 sm:p-6">
            <p className="text-sm text-gray-500">No findings found</p>
          </div>
        )}
      </div>
    </div>
  )
}