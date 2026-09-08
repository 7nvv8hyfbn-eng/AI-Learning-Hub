import { describe, expect, it } from 'vitest'
import { runMediaCommand } from '../src/common/media-process'

describe('媒体子进程资源边界', () => {
  it('保留参数原文，错误不会被当作成功输出', async () => {
    expect(await runMediaCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'value;echo unsafe'])).toBe('value;echo unsafe')
    await expect(runMediaCommand(process.execPath, ['-e', 'process.stderr.write("decode failed");process.exit(2)'])).rejects.toThrow('decode failed')
  })
  it('卡死且忽略SIGTERM的程序被强制回收', async () => {
    const start = Date.now()
    await expect(runMediaCommand(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { timeoutMs: 200, killGraceMs: 100 })).rejects.toThrow('处理超时')
    expect(Date.now() - start).toBeLessThan(3000)
  })
  it('同时限制stdout与stderr，输出洪水不会无限积累', async () => {
    await expect(runMediaCommand(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("x".repeat(4096)),1)'], { maxOutputBytes: 8192, timeoutMs: 2000 })).rejects.toThrow('输出超出安全上限')
    await expect(runMediaCommand(process.execPath, ['-e', 'setInterval(()=>process.stderr.write("x".repeat(4096)),1)'], { maxOutputBytes: 8192, timeoutMs: 2000 })).rejects.toThrow('输出超出安全上限')
  })
  it('关闭信号取消运行，预先取消的请求不启动程序', async () => {
    const controller = new AbortController()
    const work = runMediaCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal })
    controller.abort()
    await expect(work).rejects.toThrow('处理已取消')
    await expect(runMediaCommand('/does-not-exist', [], { signal: controller.signal })).rejects.toThrow('已取消')
  })
  it('启动失败被捕获', async () => {
    await expect(runMediaCommand('/does-not-exist', [])).rejects.toThrow('无法启动')
  })
})
