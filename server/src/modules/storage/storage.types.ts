import type { Readable } from 'node:stream'

export interface UploadedFile {
  originalname: string
  mimetype: string
  size: number
  buffer: Buffer
}

export interface UploadedPathFile {
  originalname: string
  mimetype: string
  size: number
  path: string
}

export interface UploadOptions {
  uploadedBy: string
  visibility: 'public' | 'private'
  catalogMedia?: boolean
  trustedSvg?: boolean
  maxBytes?: number
}

export interface StoredFile {
  id: string
  originalName: string
  mimeType: string
  size: number
  checksum: string
}

export abstract class StorageService {
  abstract upload(file: UploadedFile, options: UploadOptions): Promise<StoredFile>
  abstract uploadPath(file: UploadedPathFile, options: UploadOptions): Promise<StoredFile>
  abstract getSignedUrl(fileId: string, expiresIn?: number): Promise<string>
  abstract copyToPath(fileId: string, target: string): Promise<void>
  abstract open(fileId: string, start?: number, end?: number): Promise<{ stream: Readable; size: number; mimeType: string; originalName: string }>
  abstract delete(fileId: string): Promise<void>
  abstract exists(fileId: string): Promise<boolean>
  abstract writable(): Promise<boolean>
}

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE')
