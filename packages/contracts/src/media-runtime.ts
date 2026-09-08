export type FileScanStatus = 'not_scanned' | 'clean' | 'unavailable' | 'infected' | 'error'
export interface FileScanDto { status: FileScanStatus; message: string | null; scannedAt: string | null; quarantined: boolean }
export interface StorageCapacityDto {
  driver: string
  usedBytes: number
  reservedBytes: number
  temporaryReservedBytes: number
  quotaBytes: number
  remainingBytes: number
  activeUploads: number
  parallelUploadLimit: number
  queuedTasks: number
  queueLimit: number
  site: {
    usedBytes: number
    reservedBytes: number
    temporaryReservedBytes: number
    capacityBytes: number | null
    availableBytes: number
    temporaryFreeBytes: number
    minimumFreeBytes: number
    activeUploads: number
    queuedTasks: number
  }
  unavailableReason: string | null
}

export interface MediaRuntimeDto {
  capacity: StorageCapacityDto
  queue: Array<{ id: string; originalName: string; status: string; attempts: number; lastError: string | null; leaseExpiresAt: string | null; retryable: boolean }>
  scan: { configured: boolean; unavailableFiles: number; quarantinedFiles: number }
  cleanup: { pending: number; failures: Array<{ id: string; attempts: number; lastError: string | null }> }
}
