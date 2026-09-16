import { Type, Transform } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, Min, ValidateNested } from 'class-validator'
import type { AssistantConfigInput, AssistantDigestInput, AssistantMessageDto } from '@ai-learning-hub/contracts'

class AssistantMessageInput implements AssistantMessageDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant'
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 4000) content!: string
}
export class AssistantChatInputDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => AssistantMessageInput)
  messages!: AssistantMessageInput[]
}
export class AssistantConfigInputDto implements AssistantConfigInput {
  @IsBoolean() enabled!: boolean
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 20) name!: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 200) welcome!: string
  @IsIn(['left', 'right']) position!: 'left' | 'right'
  @IsBoolean() digestEnabled!: boolean
  @IsBoolean() keywords!: boolean
  @IsIn(['short', 'standard', 'long']) length!: 'short' | 'standard' | 'long'
  @IsIn(['plain', 'professional', 'friendly']) style!: 'plain' | 'professional' | 'friendly'
  @IsInt() @Min(1) expectedRevision!: number
}
export class AssistantDigestInputDto implements AssistantDigestInput {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 100) postId!: string
}
