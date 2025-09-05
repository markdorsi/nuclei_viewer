import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'

export default function Companies() {
  const { tenant } = useAuth()
  const queryClient = useQueryClient()
  const [isAddingCompany, setIsAddingCompany] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [newCompanySlug, setNewCompanySlug] = useState('')
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [selectAll, setSelectAll] = useState(false)

  const { data: companies, isLoading } = useQuery({
    queryKey: ['companies', tenant?.id],
    queryFn: async () => {
      const res = await fetch(`/api/t/${tenant?.slug}/companies`)
      if (!res.ok) throw new Error('Failed to fetch companies')
      return res.json()
    },
    enabled: !!tenant
  })

  const createCompany = useMutation({
    mutationFn: async (data: { name: string; slug: string }) => {
      const res = await fetch(`/api/t/${tenant?.slug}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error('Failed to create company')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies', tenant?.id] })
      setIsAddingCompany(false)
      setNewCompanyName('')
      setNewCompanySlug('')
    }
  })

  const deleteCompany = useMutation({
    mutationFn: async (companyId: string) => {
      const res = await fetch(`/api/t/${tenant?.slug}/companies`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: companyId })
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to delete company')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies', tenant?.id] })
      setSelectedCompanies([])
      setSelectAll(false)
    },
    onError: (error) => {
      alert(`Error: ${error.message}`)
    }
  })

  const bulkDeleteCompanies = useMutation({
    mutationFn: async (companyIds: string[]) => {
      const results = []
      for (const companyId of companyIds) {
        try {
          const res = await fetch(`/api/t/${tenant?.slug}/companies`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: companyId })
          })
          if (!res.ok) {
            const error = await res.json()
            results.push({ id: companyId, success: false, error: error.message })
          } else {
            results.push({ id: companyId, success: true })
          }
        } catch (error) {
          results.push({ id: companyId, success: false, error: 'Network error' })
        }
      }
      return results
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ['companies', tenant?.id] })
      setSelectedCompanies([])
      setSelectAll(false)
      
      const failed = results.filter(r => !r.success)
      if (failed.length > 0) {
        const failedMessages = failed.map(f => `Failed to delete company: ${f.error}`).join('\n')
        alert(`Some deletions failed:\n${failedMessages}`)
      }
    },
    onError: (error) => {
      alert(`Bulk delete error: ${error.message}`)
    }
  })

  const handleAddCompany = () => {
    if (newCompanyName && newCompanySlug) {
      createCompany.mutate({ name: newCompanyName, slug: newCompanySlug })
    }
  }

  const handleDeleteCompany = (company: any) => {
    if (window.confirm(`Are you sure you want to delete "${company.name}"? This action cannot be undone.`)) {
      deleteCompany.mutate(company.id)
    }
  }

  const handleSelectCompany = (companyId: string, checked: boolean) => {
    if (checked) {
      const newSelected = [...selectedCompanies, companyId]
      setSelectedCompanies(newSelected)
      
      // Check if all companies are now selected
      if (companies && newSelected.length === companies.length) {
        setSelectAll(true)
      }
    } else {
      setSelectedCompanies(prev => prev.filter(id => id !== companyId))
      setSelectAll(false)
    }
  }

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked)
    if (checked && companies) {
      setSelectedCompanies(companies.map((c: any) => c.id))
    } else {
      setSelectedCompanies([])
    }
  }

  const handleBulkDelete = () => {
    if (selectedCompanies.length === 0) return
    
    const selectedCompanyNames = companies
      ?.filter((c: any) => selectedCompanies.includes(c.id))
      .map((c: any) => c.name)
      .join(', ')
    
    if (window.confirm(`Are you sure you want to delete ${selectedCompanies.length} companies (${selectedCompanyNames})? This action cannot be undone.`)) {
      bulkDeleteCompanies.mutate(selectedCompanies)
    }
  }

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Companies</h1>
        <button
          onClick={() => setIsAddingCompany(true)}
          className="mt-3 sm:mt-0 inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          <PlusIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
          Add Company
        </button>
      </div>

      {isAddingCompany && (
        <div className="mt-6 bg-white shadow sm:rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="text-lg font-medium text-gray-900">Add New Company</h3>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Company Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label htmlFor="slug" className="block text-sm font-medium text-gray-700">
                  Slug (URL-friendly identifier)
                </label>
                <input
                  type="text"
                  id="slug"
                  value={newCompanySlug}
                  onChange={(e) => setNewCompanySlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="acme-corp"
                />
              </div>
            </div>
            <div className="mt-4 flex space-x-3">
              <button
                onClick={handleAddCompany}
                disabled={!newCompanyName || !newCompanySlug || createCompany.isPending}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {createCompany.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setIsAddingCompany(false)
                  setNewCompanyName('')
                  setNewCompanySlug('')
                }}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      {selectedCompanies.length > 0 && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-blue-800">
              {selectedCompanies.length} companies selected
            </div>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleteCompanies.isPending}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
            >
              <TrashIcon className="-ml-1 mr-2 h-4 w-4" aria-hidden="true" />
              {bulkDeleteCompanies.isPending ? 'Deleting...' : 'Delete Selected'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 bg-white shadow overflow-hidden sm:rounded-md">
        {isLoading ? (
          <div className="px-4 py-5 sm:p-6">
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : companies?.length > 0 ? (
          <div>
            {/* Select All Header */}
            <div className="px-4 py-3 sm:px-6 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label className="ml-2 text-sm font-medium text-gray-900">
                  Select All Companies
                </label>
              </div>
            </div>
            
            <ul className="divide-y divide-gray-200">
              {companies.map((company: any) => (
                <li key={company.id}>
                  <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={selectedCompanies.includes(company.id)}
                          onChange={(e) => handleSelectCompany(company.id, e.target.checked)}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{company.name}</p>
                          <p className="text-sm text-gray-500">Slug: {company.slug}</p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="text-sm text-gray-500">
                          {company.findingsCount || 0} findings
                        </div>
                        <button
                          onClick={() => handleDeleteCompany(company)}
                          disabled={deleteCompany.isPending}
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                          title="Delete company"
                        >
                          <TrashIcon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="px-4 py-5 sm:p-6">
            <p className="text-sm text-gray-500">No companies found. Add your first company to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}