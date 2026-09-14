import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, MaxLength, Min, ValidateNested } from 'class-validator'

export class AssistantMessageDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant'
  @IsString() @MaxLength(2000) content!: string
}

export class ChatAssistantDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => AssistantMessageDto)
  messages!: AssistantMessageDto[]
}

export class DigestAssistantDto {
  @IsString() @Length(1, 64) postId!: string
}

export class AssistantConfigDto {
  @IsBoolean() enabled!: boolean
  @IsString() @Length(1, 40) name!: string
  @IsString() @Length(1, 200) welcome!: string
  @IsIn(['left', 'right']) position!: 'left' | 'right'
  @IsBoolean() digestEnabled!: boolean
  @IsBoolean() keywords!: boolean
  @IsIn(['short', 'standard', 'long']) length!: 'short' | 'standard' | 'long'
  @IsIn(['plain', 'professional', 'friendly']) style!: 'plain' | 'professional' | 'friendly'
}

export class SaveAssistantConfigDto extends AssistantConfigDto {
  @IsInt() @Min(0) expectedRevision!: number
}