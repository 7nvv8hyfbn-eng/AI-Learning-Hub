import type { FileScanDto, FileScanStatus } from '@ai-learning-hub/contracts'
import type { ConfigService } from '@nestjs/config'
import { runMediaCommand } from '../../common/media-process'
import { mkdir } from 'node:fs/promises'
export const unavailableScan = { scanStatus: 'unavailable', scanMessage: '未配置本地恶意文件扫描，文件未经过恶意软件扫描', scannedAt: null, quarantinedAt: null }
let scanQueue = Promise.resolve(), pendingScans = 0

export async function scanFile(filePath: string, config: ConfigService, temporaryDirectory?: string, signal?: AbortSignal) {
  const command = config.get<string>('MEDIA_CLAMSCAN_PATH')
  if (!command) return unavailableScan
  try {
    if (pendingScans >= 64) throw new Error('扫描队列已满')
    pendingScans++
    const scan = scanQueue.then(async () => {
      if (signal?.aborted) throw new Error('扫描已取消')
      if (temporaryDirectory) await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
      await runMediaCommand(command, ['--no-summary', '--infected', '--max-filesize=1024M', '--max-scansize=2048M', '--max-files=1000', '--max-recursion=10', '--alert-exceeds-max=yes', ...(temporaryDirectory ? [`--tempdir=${temporaryDirectory}`] : []), '--', filePath], { timeoutMs: 120_000, maxOutputBytes: 64 * 1024, signal })
    })
    scanQueue = scan.catch(() => undefined)
    try { await scan } finally { pendingScans-- }
    return { scanStatus: 'clean', scanMessage: null, scannedAt: new Date(), quarantinedAt: null }
  } catch (error) {
    const infected = (error as { exitCode?: number }).exitCode === 1
    return { scanStatus: infected ? 'infected' : 'error', scanMessage: infected ? '扫描发现风险，文件已隔离' : '扫描执行失败或超时，文件已隔离', scannedAt: new Date(), quarantinedAt: new Date() }
  }
}

export function fileScanDto(file: { scanStatus: string; scanMessage: string | null; scannedAt: Date | null; quarantinedAt: Date | null }): FileScanDto {
  return { status: file.scanStatus as FileScanStatus, message: file.scanMessage, scannedAt: file.scannedAt?.toISOString() ?? null, quarantined: !!file.quarantinedAt }
}
