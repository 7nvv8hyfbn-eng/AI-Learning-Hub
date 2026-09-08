import { Transform } from 'class-transformer'
import { IsBoolean, IsEmail, IsIn, IsInt, IsNotIn, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator'
import type { PasswordForgotInput, PasswordResetInput, RegisterInput, RegistrationSettingsDto } from '@ai-learning-hub/contracts'
import { RESERVED_USERNAMES, USERNAME_PATTERN } from './username'

export class LoginDto {
  @IsOptional() @IsBoolean() remember = true
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(3, 254)
  identifier!: string

  @IsString()
  @Length(8, 128)
  password!: string
}

export class RegisterDto implements RegisterInput {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsString() @Matches(USERNAME_PATTERN) @IsNotIn(RESERVED_USERNAMES) username!: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(2, 40) displayName!: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() @Length(3, 254) email!: string
  @IsString() @Length(8, 128) @Matches(/^(?=.*[a-zA-Z])(?=.*\d)[\s\S]+$/, { message: '密码须同时包含字母和数字' }) password!: string
  @IsString() @Length(1, 60) agreementVersion!: string
  @IsOptional() @IsString() @Length(1, 128) inviteCode?: string
}
export class ForgotPasswordDto implements PasswordForgotInput {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value) @IsEmail() @Length(3, 254) email!: string
}
export class ResetPasswordDto implements PasswordResetInput {
  @IsString() @Matches(/^[A-Za-z0-9_-]{40,128}$/) token!: string
  @IsString() @Length(8, 128) @Matches(/^(?=.*[a-zA-Z])(?=.*\d)[\s\S]+$/) password!: string
}
export class VerificationDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{40,128}$/) token!: string
}
export class RegistrationSettingsInput implements RegistrationSettingsDto {
  @IsInt() @Min(1) expectedRevision!: number
  @IsIn(['open', 'invite', 'closed']) mode!: RegistrationSettingsDto['mode']
  @IsBoolean() emailVerification!: boolean
  @IsString() @Length(1, 60) agreementVersion!: string
  @IsInt() @Min(8) @Max(72) passwordMinLength!: number
  @IsBoolean() schoolRequired!: boolean
  @IsInt() @Min(1) @Max(1440) registrationRateWindowMinutes!: number
  @IsInt() @Min(10) @Max(10000) registrationMaxAttemptsPerIp!: number
  @IsInt() @Min(2) @Max(100) registrationMaxAttemptsPerIdentifier!: number
  @IsInt() @Min(5) @Max(1000) registrationMaxSuccessPerIp!: number
}

export class UpdateProfileDto {
  @IsInt() @Min(1) expectedRevision!: number
  @IsString()
  @Length(1, 40)
  displayName!: string
}

export class WechatCodeDto {
  @IsString()
  @Length(4, 256)
  code!: string
}
