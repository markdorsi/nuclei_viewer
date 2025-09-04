import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'
import { CloudArrowUpIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import { apiCall } from '../utils/api'

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800'
}

export default function Scans() {
  const { tenant } = useAuth()
  const queryClient = useQueryClient()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<string>('')
  const [fileInputKey, setFileInputKey] = useState<number>(0)
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data: scans, isLoading, error: scansError } = useQuery({
    queryKey: ['scans', tenant?.id],
    queryFn: async () => {
      console.log('🔴 SCANS QUERY: Starting for tenant:', tenant?.slug)
      const result = await apiCall(`/api/t/${tenant?.slug}/scans`)
      console.log('🔴 SCANS QUERY: Result:', result)
      return result
    },
    enabled: !!tenant
  })

  const { data: companies, error: companiesError } = useQuery({
    queryKey: ['companies', tenant?.id],
    queryFn: async () => {
      console.log('🔴 COMPANIES QUERY: Starting for tenant:', tenant?.slug)
      const result = await apiCall(`/api/t/${tenant?.slug}/companies`)
      console.log('🔴 COMPANIES QUERY: Result:', result)
      return result
    },
    enabled: !!tenant
  })

  const uploadScan = useMutation({
    mutationFn: async ({ file, companyId }: { file: File; companyId?: string }) => {
      const formData = new FormData()
      formData.append('file', file)
      if (companyId) {
        formData.append('companyId', companyId)
      }
      
      return apiCall(`/api/t/${tenant?.slug}/upload`, {
        method: 'POST',
        body: formData
      })
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['scans', tenant?.id] })
      // Reset form state
      setSelectedFile(null)
      setSelectedCompany('')
      // Force file input reset by changing key
      setFileInputKey(prev => prev + 1)
      // Show success message
      setUploadMessage({ 
        type: 'success', 
        text: `File uploaded successfully! (${data.fileSize} bytes)` 
      })
      // Clear message after 5 seconds
      setTimeout(() => setUploadMessage(null), 5000)
    },
    onError: (error: Error) => {
      setUploadMessage({ 
        type: 'error', 
        text: `Upload failed: ${error.message}` 
      })
      // Clear error message after 5 seconds
      setTimeout(() => setUploadMessage(null), 5000)
    }
  })

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('🔴 FILE SELECT: Event triggered')
    const file = e.target.files?.[0]
    console.log('🔴 FILE SELECT: Selected file:', file)
    if (file) {
      setSelectedFile(file)
      console.log('🔴 FILE SELECT: File set in state:', file.name, file.size)
    }
  }

  const handleUpload = () => {
    console.log('🔴 UPLOAD: Button clicked')
    console.log('🔴 UPLOAD: Selected file:', selectedFile)
    console.log('🔴 UPLOAD: Selected company:', selectedCompany)
    console.log('🔴 UPLOAD: Companies available:', companies?.length || 0)
    console.log('🔴 UPLOAD: Can upload?', !!selectedFile)
    
    if (selectedFile) {
      console.log('🔴 UPLOAD: Starting upload mutation...')
      // If companies exist but none selected, require selection
      // If no companies exist, allow upload (server will create from filename)
      if (companies && companies.length > 0 && !selectedCompany) {
        console.log('🔴 UPLOAD: Upload blocked - company required when companies exist')
        return
      }
      
      uploadScan.mutate({ 
        file: selectedFile, 
        companyId: selectedCompany || undefined 
      })
    } else {
      console.log('🔴 UPLOAD: Upload blocked - missing file')
    }
  }

  // Debug logging for render
  console.log('🔴 RENDER: tenant:', tenant)
  console.log('🔴 RENDER: scans data:', scans)
  console.log('🔴 RENDER: companies data:', companies)
  console.log('🔴 RENDER: selectedFile:', selectedFile)
  console.log('🔴 RENDER: selectedCompany:', selectedCompany)
  console.log('🔴 RENDER: isLoading:', isLoading)
  console.log('🔴 RENDER: scansError:', scansError)
  console.log('🔴 RENDER: companiesError:', companiesError)

  return (
    <div>
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Scans</h1>
      </div>

      <div className="mt-6 bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900">Upload Scan File</h3>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="company" className="block text-sm font-medium text-gray-700">
                Select Company {companies && companies.length === 0 && <span className="text-gray-500">(Optional - will create from filename)</span>}
              </label>
              <select
                id="company"
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                disabled={!companies || companies.length === 0}
              >
                <option value="">
                  {!companies || companies.length === 0 
                    ? 'No companies yet - will create from filename' 
                    : 'Choose a company...'}
                </option>
                {companies?.map((company: any) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="file" className="block text-sm font-medium text-gray-700">
                Scan File (Nuclei JSONL or Nmap)
              </label>
              <div className="mt-1 flex items-center">
                <input
                  key={fileInputKey}
                  type="file"
                  id="file"
                  accept=".jsonl,.json,.xml,.txt"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
              </div>
              {selectedFile && (
                <p className="mt-2 text-sm text-gray-500">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={
                !selectedFile || 
                uploadScan.isPending ||
                (companies && companies.length > 0 && !selectedCompany)
              }
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              <CloudArrowUpIcon className="-ml-1 mr-2 h-5 w-5" />
              {uploadScan.isPending ? 'Uploading...' : 'Upload Scan'}
            </button>
            
            {uploadMessage && (
              <div className={clsx(
                'mt-3 p-3 rounded-md text-sm',
                uploadMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              )}>
                {uploadMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 bg-white shadow overflow-hidden sm:rounded-md">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900">Recent Scans</h3>
        </div>
        {isLoading ? (
          <div className="px-4 pb-5 sm:px-6">
            <div className="animate-pulse space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 rounded"></div>
              ))}
            </div>
          </div>
        ) : scans?.length > 0 ? (
          <ul className="divide-y divide-gray-200">
            {scans.map((scan: any) => (
              <li key={scan.id}>
                <div className="px-4 py-4 sm:px-6 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <p className="text-sm font-medium text-gray-900">{scan.fileName}</p>
                        <span className={clsx(
                          'ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          statusColors[scan.status as keyof typeof statusColors]
                        )}>
                          {scan.status}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center text-sm text-gray-500">
                        <span>{scan.company?.name}</span>
                        <span className="mx-2">•</span>
                        <span>{scan.scanType}</span>
                        <span className="mx-2">•</span>
                        <span>{new Date(scan.scanDate).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 pb-5 sm:px-6">
            <p className="text-sm text-gray-500">No scans found. Upload your first scan to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}