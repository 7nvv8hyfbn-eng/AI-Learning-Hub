import { afterEach, describe, expect, it } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanFile } from '../src/modules/storage/file-scan'
import { validateVideoProbe } from '../src/modules/resources/video-processing.service'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))) })
describe('真实格式与扫描故障边界', () => {
  const probe = () => ({ format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '60' }, streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1920, height: 1080, avg_frame_rate: '30000/1001' }] })
  it('接受正常帧率、时长与容器', () => { expect(validateVideoProbe(probe()).duration).toBe(60) })
  it.each(['duration', 'pixels', 'fps', 'format', 'infinite', 'tracks'])('拒绝异常处理成本：%s', (kind) => {
    const input = probe()
    if (kind === 'duration') input.format.duration = '14401'
    if (kind === 'pixels') input.streams[0].width = 100000
    if (kind === 'fps') input.streams[0].avg_frame_rate = '1000/1'
    if (kind === 'format') input.format.format_name = 'hls'
    if (kind === 'infinite') input.streams[0].avg_frame_rate = '1/0'
    if (kind === 'tracks') input.streams = Array.from({ length: 9 }, () => input.streams[0])
    expect(() => validateVideoProbe(input)).toThrow('超出处理范围')
  })
  it('没有扫描程序时明确未扫描，启动失败时隔离', async () => {
    expect(await scanFile('/unused', new ConfigService({ MEDIA_CLAMSCAN_PATH: '' }))).toMatchObject({ scanStatus: 'unavailable', scannedAt: null, quarantinedAt: null })
    expect(await scanFile('/unused', new ConfigService({ MEDIA_CLAMSCAN_PATH: '/missing/synthetic-scanner' }))).toMatchObject({ scanStatus: 'error', quarantinedAt: expect.any(Date) })
  })
  it.each([0, 1, 2])('真实子进程退出码%s分别结算通过、风险、执行故障', async (code) => {
    const root = await mkdtemp(join(tmpdir(), 'aihub-scan-test-')); roots.push(root)
    const scanner = join(root, 'synthetic-scanner')
    await writeFile(scanner, `#!/usr/bin/env node\nprocess.exit(${code})\n`, { mode: 0o700 })
    const result = await scanFile(join(root, 'inert-document'), new ConfigService({ MEDIA_CLAMSCAN_PATH: scanner }))
    expect(result.scanStatus).toBe(['clean', 'infected', 'error'][code])
    expect(!!result.quarantinedAt).toBe(code !== 0)
  })
})
