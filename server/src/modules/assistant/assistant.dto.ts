import { Type, Transform } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsString, Length, Min, ValidateNested } from 'class-validator'
import type { AssistantConfigInput, AssistantMessageDto } from '@ai-learning-hub/contracts'

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
  @IsInt() @Min(1) expectedRevision!: number
}
