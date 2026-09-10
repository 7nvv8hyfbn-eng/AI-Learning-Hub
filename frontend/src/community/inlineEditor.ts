export interface InlineEditorAdapter {
  read(): { text: string; caret: number; rect: DOMRect } | null
  replace(start: number, end: number, text: string): void
}
