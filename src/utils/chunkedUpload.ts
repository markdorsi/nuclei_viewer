import { apiCall } from './api'

const CHUNK_SIZE = 1 * 1024 * 1024 // 1MB chunks to avoid memory issues

export interface ChunkUploadOptions {
  file: File
  tenantSlug: string
  onProgress?: (progress: number) => void
  companyId?: string
  companyName?: string
}

export interface ChunkUploadResult {
  uploadId: string
  fileName: string
  fileSize: number
  totalChunks: number
  message: string
}

export async function uploadFileInChunks({
  file,
  tenantSlug,
  onProgress,
  companyId,
  companyName
}: ChunkUploadOptions): Promise<ChunkUploadResult> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  
  console.log('🟢 CHUNKED UPLOAD: Starting chunked upload', {
    fileName: file.name,
    fileSize: file.size,
    totalChunks,
    uploadId,
    chunkSize: CHUNK_SIZE
  })

  // Upload each chunk
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end)
    
    console.log(`🟢 CHUNKED UPLOAD: Uploading chunk ${chunkIndex + 1}/${totalChunks}`, {
      start,
      end,
      chunkSize: chunk.size
    })

    const formData = new FormData()
    formData.append('uploadId', uploadId)
    formData.append('chunkIndex', chunkIndex.toString())
    formData.append('totalChunks', totalChunks.toString())
    formData.append('fileName', file.name)
    
    // Add raw chunk data 
    formData.append('chunk', chunk)
    
    // Add company info to ALL chunks so they go to the right company
    if (companyId) {
      formData.append('companyId', companyId)
    }
    if (companyName) {
      formData.append('companyName', companyName)
    }

    try {
      const result = await apiCall(`/api/t/${tenantSlug}/upload-chunk`, {
        method: 'POST',
        body: formData
      })
      
      console.log(`🟢 CHUNKED UPLOAD: Chunk ${chunkIndex + 1} uploaded successfully:`, result)
      
      // Update progress
      if (onProgress) {
        const progress = ((chunkIndex + 1) / totalChunks) * 100
        onProgress(progress)
      }
    } catch (error) {
      console.error(`🟢 CHUNKED UPLOAD: Failed to upload chunk ${chunkIndex + 1}:`, error)
      throw new Error(`Failed to upload chunk ${chunkIndex + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // All chunks uploaded successfully - no assembly needed since we store in database
  console.log('🟢 CHUNKED UPLOAD: All chunks uploaded and stored in database')
  
  return {
    uploadId,
    fileName: file.name,
    fileSize: file.size,
    totalChunks,
    message: `File uploaded successfully as ${totalChunks} chunks stored in database`
  }
}