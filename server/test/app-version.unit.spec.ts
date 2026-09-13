import { describe, expect, it } from 'vitest'
import { AppController } from '../src/app.controller'
import type { OperationsService } from '../src/modules/persistence/operations.service'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('应用版本接口', () => {
  it('读取服务端制品版本，并保留原有提交和环境字段', () => {
    const result = new AppController({} as OperationsService).version()
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
    expect(result).toEqual({ version: pkg.version, commit: process.env.APP_COMMIT_SHA || 'development', environment: process.env.NODE_ENV || 'development' })
  })
})
