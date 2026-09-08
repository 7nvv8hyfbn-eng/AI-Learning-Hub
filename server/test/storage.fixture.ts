import { vi } from 'vitest'
import type { StorageQuotaService } from '../src/modules/storage/storage-quota.service'

/** 文件格式/失败补偿单测只替代配额边界；配额原子性由真实PG专项验证。 */
export function fileQuotaStub(database: unknown) {
  const db = database as { $transaction?: (work: (tx: unknown) => unknown) => unknown; fileRecord?: { count?: unknown } }
  db.$transaction ||= async (work) => work(db)
  if (db.fileRecord) db.fileRecord.count ||= vi.fn(async () => 0)
  return {
    current: () => ({ id: 'synthetic-reservation', claimToken: 'synthetic-claim' }),
    workspace: () => '/unused-synthetic-scan',
    within: (_handle: unknown, work: () => unknown) => work(),
    settleFile: vi.fn(),
  } as unknown as StorageQuotaService
}
