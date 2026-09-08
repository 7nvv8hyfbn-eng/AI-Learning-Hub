import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { CampusIdentityVerificationInputDto } from '../src/modules/users/users.dto'
import { appValidationPipe } from '../src/common/validation.pipe'

async function validationMessages(input: Record<string, unknown>) {
  try {
    await appValidationPipe.transform(input, { type: 'body', metatype: CampusIdentityVerificationInputDto })
    return []
  } catch (error) {
    return (error as { getResponse(): { message: string[] } }).getResponse().message
  }
}

describe('全局请求校验中文提示', () => {
  it('将字段格式和长度错误统一输出为中文', async () => {
    const messages = await validationMessages({ realName: '11', idNumber: '12312313123', className: '123132', studentNo: '123123' })
    expect(messages).toEqual(['真实姓名格式不正确', '身份证号长度不符合要求'])
  })

  it('未知输入项不再透传英文默认消息', async () => {
    const messages = await validationMessages({ realName: '测试同学', idNumber: '11010519491231002X', className: '人工智能一班', studentNo: 'AI2026001', unexpected: true })
    expect(messages).toEqual(['包含不支持的输入项'])
    expect(messages.join('')).not.toMatch(/[A-Za-z]{3,}/)
  })
})
