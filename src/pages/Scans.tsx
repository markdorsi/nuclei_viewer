import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../hooks/useAuth";
import { CloudArrowUpIcon, DocumentIcon, XCircleIcon } from "@heroicons/react/24/outline";

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB max
const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks

export default function Scans() {
  const { token, tenant } = useAuth();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scanName, setScanName] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'complete' | 'error'>('idle');
  const [error, setError] = useState<string>("");
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  
  const uploadIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Query to list scans (keeping existing functionality)
  const { data: scans, isLoading: isLoadingScans } = useQuery({
    queryKey: ['scans', tenant?.slug],
    queryFn: async () => {
      console.log('🔍 Fetching scans for tenant:', tenant?.slug)
      const res = await fetch(`/api/t/${tenant?.slug}/scans/list`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (!res.ok) {
        throw new Error('Failed to fetch scans')
      }
      const data = await res.json()
      console.log('📄 Scans fetched:', data)
      return data
    },
    enabled: !!token && !!tenant?.slug
  })

  const calculateChunks = (fileSize: number, chunkSize: number) => {
    return Math.ceil(fileSize / chunkSize);
  }

  const uploadChunk = async (
    file: File,
    uploadId: string,
    chunkIndex: number,
    totalChunks: number,
    chunkSize: number
  ) => {
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    
    const response = await fetch(
      `/api/t/${tenant?.slug}/scans/chunk?uploadId=${uploadId}&index=${chunkIndex}&total=${totalChunks}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: chunk,
        signal: abortControllerRef.current?.signal
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to upload chunk ${chunkIndex + 1}`);
    }

    return response.json();
  }

  const startChunkedUpload = async () => {
    if (!selectedFile) return;

    setError("");
    setUploadStatus('uploading');
    setUploadProgress(0);
    abortControllerRef.current = new AbortController();

    try {
      // Step 1: Start upload session
      const startRes = await fetch(`/api/t/${tenant?.slug}/scans/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          scanName: scanName || selectedFile.name,
          contentType: selectedFile.type || "application/octet-stream",
          fileSize: selectedFile.size
        }),
      });

      if (!startRes.ok) {
        const error = await startRes.json();
        throw new Error(error.message || error.error || "Failed to start upload");
      }

      const { uploadId, maxChunkBytes } = await startRes.json();
      uploadIdRef.current = uploadId;
      
      const chunkSize = maxChunkBytes || DEFAULT_CHUNK_SIZE;
      const chunks = calculateChunks(selectedFile.size, chunkSize);
      setTotalChunks(chunks);

      // Step 2: Upload chunks
      for (let i = 0; i < chunks; i++) {
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('Upload aborted');
        }

        setCurrentChunk(i + 1);
        
        await uploadChunk(selectedFile, uploadId, i, chunks, chunkSize);
        
        const progress = Math.round(((i + 1) / chunks) * 100);
        setUploadProgress(progress);
      }

      // Step 3: Complete upload
      const completeRes = await fetch(`/api/t/${tenant?.slug}/scans/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ uploadId }),
      });

      if (!completeRes.ok) {
        const error = await completeRes.json();
        throw new Error(error.message || "Failed to complete upload");
      }

      setUploadStatus('complete');
      setSelectedFile(null);
      setScanName("");
      uploadIdRef.current = null;
      console.log('✅ Upload complete, invalidating cache for tenant:', tenant?.slug)
      queryClient.invalidateQueries({ queryKey: ["scans", tenant?.slug] });
      
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || "Upload failed");
      setUploadStatus('error');
      
      // Try to abort the upload session
      if (uploadIdRef.current) {
        try {
          await fetch(`/api/t/${tenant?.slug}/scans/abort`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ uploadId: uploadIdRef.current }),
          });
        } catch (abortErr) {
          console.error('Failed to abort upload:', abortErr);
        }
      }
    }
  };

  const cancelUpload = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    if (uploadIdRef.current) {
      try {
        await fetch(`/api/t/${tenant?.slug}/scans/abort`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ uploadId: uploadIdRef.current }),
        });
      } catch (err) {
        console.error('Failed to abort upload:', err);
      }
    }
    
    setUploadStatus('idle');
    setUploadProgress(0);
    setCurrentChunk(0);
    setTotalChunks(0);
    uploadIdRef.current = null;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large. Maximum size is ${Math.round(MAX_FILE_SIZE / (1024 * 1024 * 1024))}GB`)
      return
    }

    setError('')
    setUploadStatus('idle')
    setUploadProgress(0)
    setSelectedFile(file)
    setCurrentChunk(0)
    setTotalChunks(0)
    
    // Auto-generate scan name if not provided
    if (!scanName) {
      const today = new Date().toISOString().split('T')[0]
      const baseName = file.name.split('.')[0]
      setScanName(`${baseName}-${today}`)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Scan Upload</h1>
        <p className="mt-2 text-sm text-gray-600">
          Upload security scan files up to 5GB using chunked uploads. Files are stored in Netlify Blobs with multi-tenant isolation.
        </p>
      </div>

      {/* Upload Card */}
      <div className="bg-white shadow sm:rounded-lg mb-8">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Upload Scan File</h3>
          
          {/* Scan Name Input */}
          <div className="mb-4">
            <label htmlFor="scan-name" className="block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              type="text"
              id="scan-name"
              value={scanName}
              onChange={(e) => setScanName(e.target.value)}
              disabled={uploadStatus === 'uploading'}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm disabled:opacity-50"
              placeholder="nuclei-2024-09-05.jsonl"
            />
          </div>

          {/* File Input */}
          <div className="mb-4">
            <label htmlFor="file-upload" className="block text-sm font-medium text-gray-700">
              File
            </label>
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
              <div className="space-y-1 text-center">
                <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
                <div className="flex text-sm text-gray-600">
                  <label
                    htmlFor="file-upload"
                    className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500"
                  >
                    <span>Upload a file</span>
                    <input
                      id="file-upload"
                      name="file-upload"
                      type="file"
                      className="sr-only"
                      accept=".json,.jsonl,.xml,.txt"
                      onChange={handleFileSelect}
                      disabled={uploadStatus === 'uploading'}
                    />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-xs text-gray-500">
                  JSON, JSONL, XML, TXT up to 5GB
                </p>
              </div>
            </div>
          </div>

          {/* Selected File Info */}
          {selectedFile && (
            <div className="mb-4 p-3 bg-gray-50 rounded-md">
              <p className="text-sm text-gray-900">
                <strong>Selected:</strong> {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </p>
              {totalChunks > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Will be uploaded in {totalChunks} chunks
                </p>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Upload Progress */}
          {uploadStatus === 'uploading' && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Uploading chunk {currentChunk} of {totalChunks}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Success Message */}
          {uploadStatus === 'complete' && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">Upload complete!</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            {uploadStatus !== 'uploading' ? (
              <button
                onClick={startChunkedUpload}
                disabled={!selectedFile || uploadStatus === 'uploading'}
                className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CloudArrowUpIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                Upload
              </button>
            ) : (
              <button
                onClick={cancelUpload}
                className="inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              >
                <XCircleIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                Cancel Upload
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scans List */}
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Uploaded Scans</h3>
          
          {isLoadingScans ? (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading scans...</p>
            </div>
          ) : scans?.length > 0 ? (
            <div className="overflow-hidden">
              <ul className="divide-y divide-gray-200">
                {scans.map((scan: any, index: number) => (
                  <li key={scan.key || index} className="py-3">
                    <div className="flex items-center space-x-3">
                      <DocumentIcon className="h-6 w-6 text-gray-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {scan.key.split('/').pop()}
                        </p>
                        <p className="text-sm text-gray-500">
                          {formatFileSize(scan.size)} • {formatDate(scan.uploadedAt)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="text-center py-8">
              <DocumentIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-sm text-gray-500">No scans uploaded yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}