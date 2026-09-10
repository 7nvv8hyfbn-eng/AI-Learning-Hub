<script lang="ts">
let bodyLockCount = 0
let bodyOverflowBeforeDialogs = ''
const openedDialogs: HTMLDialogElement[] = []
</script>
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import AppIcon from './AppIcon.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  closeOnBackdrop?: boolean
  /** 关闭前守卫:返回 false 则阻止本次关闭(用于"内容未保存"确认);所有关闭途径(✕/Esc/遮罩)都会先经过它 */
  beforeClose?: () => boolean
}>(), { closeOnBackdrop: true })

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const dialog = ref<HTMLDialogElement>()
const titleId = `dialog-${useId()}`
let previousFocus: HTMLElement | null = null
let holdsBodyLock = false
const releaseBodyLock = () => {
  if (!holdsBodyLock) return
  holdsBodyLock = false
  const index = dialog.value ? openedDialogs.indexOf(dialog.value) : -1
  if (index >= 0) openedDialogs.splice(index, 1)
  if (--bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeDialogs
}

const close = () => {
  // 关闭前守卫:业务方可通过 beforeClose 阻止误关闭(如内容未保存)
  if (props.beforeClose && !props.beforeClose()) return
  emit('update:modelValue', false)
}

const syncDialog = async (open: boolean) => {
  await nextTick()
  if (!dialog.value) return
  if (open && !dialog.value.open) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (bodyLockCount++ === 0) bodyOverflowBeforeDialogs = document.body.style.overflow
    holdsBodyLock = true
    openedDialogs.push(dialog.value)
    document.body.style.overflow = 'hidden'
    dialog.value.showModal()
    const target = dialog.value.querySelector<HTMLElement>('[autofocus]') || dialog.value.querySelector<HTMLElement>('input, select, textarea, button, a')
    target?.focus({ preventScroll: true })
  } else if (!open && dialog.value.open) {
    dialog.value.close()
    releaseBodyLock()
    const parentDialog = openedDialogs.at(-1)
    const canRestore = previousFocus?.isConnected && previousFocus.getClientRects().length && !previousFocus.matches(':disabled') && !previousFocus.closest('[inert], dialog:not([open])') && (!parentDialog || parentDialog.contains(previousFocus))
    const target = canRestore ? previousFocus : parentDialog?.querySelector<HTMLElement>('input, select, textarea, button, a[href]') || document.querySelector<HTMLElement>('a.skip-link')
    target?.focus({ preventScroll: true })
  }
}

const onCancel = (event: Event) => {
  event.preventDefault()
  close()
}

const onBackdrop = (event: MouseEvent) => {
  if (props.closeOnBackdrop && event.target === dialog.value) close()
}

const onKeydown = (event: KeyboardEvent) => {
  if (props.modelValue && event.key === 'Escape' && openedDialogs.at(-1) === dialog.value) {
    event.preventDefault()
    close()
  }
}

watch(() => props.modelValue, syncDialog, { immediate: true })
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  releaseBodyLock()
})
</script>

<template>
  <Teleport to="body">
    <dialog v-bind="$attrs" ref="dialog" class="app-dialog" :aria-labelledby="titleId" @cancel="onCancel" @click="onBackdrop">
      <div class="dialog-card" @click.stop>
        <slot name="header" :close="close" :title-id="titleId"><div class="dialog-title">
          <strong :id="titleId">{{ title }}</strong>
          <button class="icon-button close-button" type="button" :aria-label="`关闭${title}`" @click="close"><AppIcon name="close" :size="18" /></button>
        </div></slot>
        <slot :close="close" />
      </div>
    </dialog>
  </Teleport>
</template>
