import { spawn } from 'node:child_process'
import * as path from 'node:path'

export interface MediaCommandOptions {
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  killGraceMs?: number
}

/** 不经shell执行；超时、输出超限和取消均等待进程组退出后再返回。 */
export function runMediaCommand(command: string, args: string[], options: MediaCommandOptions = {}) {
  return new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('媒体处理已取消')); return }
    const name = path.basename(command)
    const grouped = process.platform !== 'win32'
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: grouped, windowsHide: true })
    const outputLimit = options.maxOutputBytes ?? 1024 * 1024
    let stdout = '', stderr = '', outputBytes = 0, failure: Error | undefined
    let killTimer: NodeJS.Timeout | undefined
    const signal = (value: NodeJS.Signals) => {
      if (!child.pid) return
      try { if (grouped) process.kill(-child.pid, value); else child.kill(value) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ||= new Error(`${name} 无法停止子进程`) }
    }
    const stop = (message: string) => {
      if (failure) return
      failure = new Error(message)
      signal('SIGTERM')
      killTimer = setTimeout(() => signal('SIGKILL'), options.killGraceMs ?? 2000)
      killTimer.unref()
    }
    const abort = () => stop(`${name} 处理已取消`)
    const timer = setTimeout(() => stop(`${name} 处理超时`), options.timeoutMs ?? 30 * 60_000)
    timer.unref()
    options.signal?.addEventListener('abort', abort, { once: true })
    const output = (chunk: Buffer, error: boolean) => {
      outputBytes += chunk.length
      if (outputBytes > outputLimit) { stop(`${name} 输出超出安全上限`); return }
      if (error) stderr = `${stderr}${chunk.toString()}`.slice(-8000)
      else stdout += chunk.toString()
    }
    child.stdout.on('data', (chunk: Buffer) => output(chunk, false))
    child.stderr.on('data', (chunk: Buffer) => output(chunk, true))
    child.once('error', (error) => { failure ||= new Error(`${name} 无法启动：${error.message}`) })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      options.signal?.removeEventListener('abort', abort)
      // 父进程可能先退出，仍需清理继承管道以外的派生进程。
      if (failure) signal('SIGKILL')
      if (failure) reject(failure)
      else if (code === 0) resolve(stdout)
      else reject(Object.assign(new Error(`${name} 处理失败（${code ?? 'signal'}）：${stderr.trim() || '没有错误输出'}`), { exitCode: code }))
    })
  })
}
