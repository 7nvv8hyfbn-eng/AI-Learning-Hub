import { BadRequestException, ValidationPipe } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

const fieldLabels: Record<string, string> = {
  agreementVersion: '协议版本',
  className: '班级',
  displayName: '显示名称',
  email: '邮箱',
  idNumber: '身份证号',
  identifier: '账号或邮箱',
  inviteCode: '邀请码',
  password: '密码',
  realName: '真实姓名',
  reason: '操作原因',
  studentNo: '学号',
  token: '验证令牌',
  username: '登录账号',
}

function defaultMessage(constraint: string, label: string) {
  switch (constraint) {
    case 'whitelistValidation': return '包含不支持的输入项'
    case 'isDefined': return `${label}不能为空`
    case 'isString': return `${label}必须为文本`
    case 'isBoolean': return `${label}必须为布尔值`
    case 'isDateString': return `${label}日期格式不正确`
    case 'isEmail': return `请输入有效的${label}`
    case 'isEnum': case 'isIn': return `${label}请选择有效选项`
    case 'isNotIn': return `${label}不能使用该值`
    case 'isHexColor': return `${label}颜色格式不正确`
    case 'isInt': return `${label}必须为整数`
    case 'isNumber': return `${label}必须为数字`
    case 'isObject': case 'nestedValidation': return `${label}格式不正确`
    case 'isUrl': return `${label}链接格式不正确`
    case 'isLength': return `${label}长度不符合要求`
    case 'maxLength': case 'arrayMaxSize': return `${label}超出长度或数量限制`
    case 'minLength': return `${label}长度不足`
    case 'arrayUnique': return `${label}不能包含重复项`
    case 'isArray': return `${label}必须为列表`
    case 'matches': return `${label}格式不正确`
    case 'max': return `${label}不能超过允许上限`
    case 'min': return `${label}不能低于允许下限`
    default: return `${label}输入不正确`
  }
}

function collectMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => {
    const label = /^\d+$/.test(error.property) ? `第${Number(error.property) + 1}项` : fieldLabels[error.property] || '输入内容'
    const own = Object.entries(error.constraints || {}).map(([constraint, message]) => /[\u3400-\u9fff]/u.test(message) ? message : defaultMessage(constraint, label))
    return [...own, ...collectMessages(error.children || [])]
  })
}

export const appValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) => new BadRequestException([...new Set(collectMessages(errors))]),
})
