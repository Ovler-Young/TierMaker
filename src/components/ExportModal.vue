<script setup lang="ts">
import { ref, computed } from 'vue'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { getItemUrl } from '../utils/url'
import { processExportImages, processEmptySlots, configureExportStyles, hideExportUIElements, syncThemeToClonedDoc } from '../utils/exportUtils'
import { getSize } from '../utils/configManager'
import { adaptCropToRatio, normalizeCropResolution } from '../utils/cropUtils'
import { exportAllData } from '../utils/storage'
import type { Tier, TierConfig, AnimeItem, CropPosition } from '../types'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  tiers: Tier[]
  tierConfigs: TierConfig[]
  appContentRef: HTMLElement | null
  title: string
  titleFontSize: number
  exportScale: number
}>()

const emit = defineEmits<{
  close: []
}>()

const isExportingImage = ref(false)
const isExportingPDF = ref(false)
const exportProgress = ref('')
const exportItemsPerRow = ref(0) // 0 = 自动

// 获取当前主题对应的背景色
function getCurrentThemeBackgroundColor(): string {
  const computedStyle = getComputedStyle(document.documentElement)
  const bgColor = computedStyle.getPropertyValue('--bg-color').trim()
  
  if (bgColor) {
    return bgColor
  }
  
  const html = document.documentElement
  const theme = html.getAttribute('data-theme') || 'auto'
  
  if (theme === 'dark') {
    return '#1a1a1a'
  }
  
  if (theme === 'auto') {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return '#1a1a1a'
    }
  }
  
  return '#ffffff'
}

// 使用CORS代理获取图片
function getCorsProxyUrl(url: string): string {
  if (!url) return ''
  if (url.includes('wsrv.nl') || url.includes('i0.wp.com')) return url
  
  if (url.includes('vndb.org') || url.includes('t.vndb.org')) {
    // VNDB 不支持 wsrv.nl 代理，使用 Jetpack 代理作为替代
    const proxyUrl = `https://i0.wp.com/${url.replace(/^https?:\/\//, '')}`
    console.log(`[Export] VNDB image detected, using Jetpack proxy: ${url} -> ${proxyUrl}`)
    return proxyUrl
  }
  
  const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&output=png`
  console.log(`[Export] Using wsrv.nl proxy: ${url} -> ${proxyUrl}`)
  return proxyUrl
}

// 智能裁剪图片
function applySmartCropToImage(img: HTMLImageElement) {
  if (img.naturalWidth && img.naturalHeight) {
    const itemId = img.getAttribute('data-item-id')
    let cropPosition: CropPosition = 'auto'
    
    if (itemId) {
      let found = false
      for (const tier of props.tiers) {
        for (const row of tier.rows) {
          const item = row.items.find(i => String(i.id) === String(itemId))
          if (item) {
            cropPosition = item.cropPosition || 'auto'
            found = true
            break
          }
        }
        if (found) break
      }
    }
    
    const ratio = img.naturalWidth / img.naturalHeight
    
    const width = Number(getSize('image-width')) || 100
    const height = Number(getSize('image-height')) || 133
    // Calculate target ratio dynamically from config, fallback to 0.75 if something is wrong (shouldn't happen)
    const targetRatio = (width && height) ? (width / height) : 0.75

    img.style.objectFit = 'cover'
    img.style.width = `${width}px`
    img.style.height = `${height}px`
    img.style.position = 'static'
    img.style.left = 'auto'
    img.style.top = 'auto'
    img.style.transform = 'none'
    
    if (cropPosition === 'auto') {
      if (ratio < targetRatio) {
        img.style.objectPosition = 'center top'
      } else {
        img.style.objectPosition = 'center center'
      }
    } else {
      if (typeof cropPosition === 'string') {
        img.style.objectPosition = cropPosition
      }
    }
  }
}

// 使用canvas裁剪图片
async function cropImageWithCanvas(img: HTMLImageElement, scale: number = 1): Promise<string | null> {
  if (!img.naturalWidth || !img.naturalHeight) {
    return null
  }
  
  const itemId = img.getAttribute('data-item-id')
  let cropPosition: CropPosition = 'auto'
  
  if (itemId) {
    let found = false
    for (const tier of props.tiers) {
      for (const row of tier.rows) {
        const item = row.items.find(i => String(i.id) === String(itemId))
        if (item) {
          cropPosition = item.cropPosition || 'auto'
          found = true
          break
        }
      }
      if (found) break
    }
  }
  
  const naturalWidth = img.naturalWidth
  const naturalHeight = img.naturalHeight
  const naturalAspectRatio = naturalWidth / naturalHeight
  
  const containerWidth = (Number(getSize('image-width')) || 100) * scale
  const containerHeight = (Number(getSize('image-height')) || 133) * scale
  const targetAspectRatio = containerWidth / containerHeight
  
  const canvas = document.createElement('canvas')
  canvas.width = containerWidth
  canvas.height = containerHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  
  let sourceX = 0
  let sourceY = 0
  let sourceWidth = naturalWidth
  let sourceHeight = naturalHeight
  
  if (typeof cropPosition === 'object' && cropPosition !== null && 'sourceX' in cropPosition) {
    const { sourceX, sourceY, sourceWidth } = cropPosition
    
    let liveNaturalWidth = naturalWidth
    let liveNaturalHeight = naturalHeight
    
    if (itemId) {
      const foundItem = props.tiers.flatMap(t => t.rows.flatMap(r => r.items)).find(i => String(i.id) === String(itemId))
      if (foundItem && foundItem.naturalWidth) {
        liveNaturalWidth = foundItem.naturalWidth
        liveNaturalHeight = foundItem.naturalHeight || naturalHeight
      }
    }
    
    const exportTargetRatio = containerWidth / containerHeight
    
    let effectiveCrop = normalizeCropResolution(
      cropPosition,
      liveNaturalWidth,
      naturalWidth
    )
    
    effectiveCrop = adaptCropToRatio(
      effectiveCrop,
      exportTargetRatio,
      naturalWidth,
      naturalHeight
    )
    
    const { sourceX: finalSX, sourceY: finalSY, sourceWidth: finalSW } = effectiveCrop
    const renderScale = containerWidth / finalSW
    const destWidth = naturalWidth * renderScale
    const destHeight = (naturalHeight / naturalWidth) * destWidth
    const destX = -finalSX * renderScale
    const destY = -finalSY * renderScale

    try {
      ctx.drawImage(img, destX, destY, destWidth, destHeight)
    } catch (e) {
      console.error('Canvas draw failed', e)
      return null
    }

    return canvas.toDataURL('image/png')
  } else if (naturalAspectRatio > targetAspectRatio) {
    const scaleByHeight = containerHeight / naturalHeight
    const targetWidthInOriginal = containerWidth / scaleByHeight
    sourceWidth = targetWidthInOriginal
    
    if (cropPosition === 'left center') {
      sourceX = 0
    } else if (cropPosition === 'right center') {
      sourceX = naturalWidth - sourceWidth
    } else {
      sourceX = (naturalWidth - sourceWidth) / 2
    }
    
    sourceY = 0
    sourceHeight = naturalHeight
  } else {
    const scaleByWidth = containerWidth / naturalWidth
    const targetHeightInOriginal = containerHeight / scaleByWidth
    sourceHeight = targetHeightInOriginal
    
    if (cropPosition === 'center top') {
      sourceY = 0
    } else if (cropPosition === 'center bottom') {
      sourceY = naturalHeight - sourceHeight
    } else {
      sourceY = 0
    }
    
    sourceX = 0
    sourceWidth = naturalWidth
  }
  
  try {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    
    ctx.drawImage(
      img,
      Math.round(sourceX), Math.round(sourceY), Math.round(sourceWidth), Math.round(sourceHeight),
      0, 0, containerWidth, containerHeight
    )
    
    return canvas.toDataURL('image/png', 1.0)
  } catch (error) {
    console.error('裁剪图片失败:', error)
    return null
  }
}

// 导出为图片
async function handleExportImage() {
  if (!props.appContentRef) {
    alert('无法找到要导出的内容')
    return
  }
  
  if (isExportingImage.value) return
  
  isExportingImage.value = true
  exportProgress.value = t('export.preparing')
  
  try {
    const originalScrollX = window.scrollX
    const originalScrollY = window.scrollY
    window.scrollTo(0, 0)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const originalNode = props.appContentRef
    const clonedNode = originalNode.cloneNode(true) as HTMLElement
    
    const hiddenContainer = document.createElement('div')
    hiddenContainer.style.position = 'fixed'
    hiddenContainer.style.left = '-9999px'
    hiddenContainer.style.zIndex = '-1000'
    hiddenContainer.style.width = originalNode.offsetWidth + 'px'
    hiddenContainer.appendChild(clonedNode)
    document.body.appendChild(hiddenContainer)
    
    const currentScale = props.exportScale
    
    exportProgress.value = t('export.syncTheme')
    syncThemeToClonedDoc(hiddenContainer)
    hideExportUIElements(hiddenContainer, { hideCandidates: true, hideUnranked: true })
    processEmptySlots(hiddenContainer)
    
    exportProgress.value = t('export.processingImages')
    await processExportImages(hiddenContainer, currentScale, cropImageWithCanvas, getCorsProxyUrl, applySmartCropToImage, 'image')
    
    const originalAppWidth = originalNode.offsetWidth || originalNode.scrollWidth
    let computedTitleFontSize = 32
    try {
      const originalTitle = document.querySelector('.title') as HTMLElement
      if (originalTitle) {
        const computedStyle = window.getComputedStyle(originalTitle)
        const parsedSize = parseFloat(computedStyle.fontSize)
        if (!isNaN(parsedSize) && parsedSize > 0) {
          computedTitleFontSize = parsedSize
        }
      }
    } catch (e) {
      console.warn('获取标题字体大小失败，使用默认值32px:', e)
    }
    configureExportStyles(hiddenContainer, { titleFontSize: computedTitleFontSize, originalAppWidth, itemsPerRow: exportItemsPerRow.value || undefined })

    exportProgress.value = t('export.generatingImage')
    const canvas = await html2canvas(clonedNode, {
      scale: currentScale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: getCurrentThemeBackgroundColor(),
      imageTimeout: 15000,
    })
    
    document.body.removeChild(hiddenContainer)
    window.scrollTo(originalScrollX, originalScrollY)
    
    exportProgress.value = t('export.downloading')
    canvas.toBlob((blob) => {
      if (!blob) {
        alert('生成图片失败')
        isExportingImage.value = false
        exportProgress.value = ''
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tier-list-${new Date().toISOString().split('T')[0]}.jpg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      isExportingImage.value = false
      exportProgress.value = ''
      emit('close')
    }, 'image/jpeg', 0.9)
    
  } catch (error) {
    console.error('导出图片失败:', error)
    alert(t('export.exportFailed'))
    const containers = document.querySelectorAll('div[style*="left: -9999px"]')
    containers.forEach(c => c.remove())
  } finally {
    isExportingImage.value = false
    exportProgress.value = ''
  }
}

// 导出为PDF
async function handleExportPDF() {
  if (isExportingPDF.value || isExportingImage.value) return
  
  try {
    isExportingPDF.value = true
    exportProgress.value = t('export.preparing')
    
    if (!props.appContentRef) {
      alert(t('export.cannotFindContent'))
      return
    }
    
    await new Promise(resolve => setTimeout(resolve, 100))
    
    const originalScrollX = window.scrollX
    const originalScrollY = window.scrollY
    
    window.scrollTo(0, 0)
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // 收集链接信息
    const itemLinks: Array<{ url: string; rect: DOMRect; item: AnimeItem }> = []
    
    props.tiers.forEach(tier => {
      tier.rows.forEach(row => {
        row.items.forEach((item, itemIndex) => {
          if (item.id) {
            const url = getItemUrl(item)
            if (!url) return
            
            const imgElement = document.querySelector(`img[data-item-id="${item.id}"]`) as HTMLImageElement
            let itemElement: HTMLElement | null = null
            
            if (imgElement) {
              itemElement = imgElement.closest('.tier-item') as HTMLElement
            }
            
            if (!itemElement && row.id) {
              const rowElement = document.querySelector(`[data-row-id="${row.id}"]`) as HTMLElement
              if (rowElement) {
                const tierItems = rowElement.querySelectorAll('.tier-item:not(.empty)')
                if (itemIndex < tierItems.length) {
                  itemElement = tierItems[itemIndex] as HTMLElement
                }
              }
            }
            
            if (itemElement) {
              const rect = itemElement.getBoundingClientRect()
              const appRect = props.appContentRef!.getBoundingClientRect()
              const relativeRect = new DOMRect(
                rect.left - appRect.left,
                rect.top - appRect.top,
                rect.width,
                rect.height
              )
              itemLinks.push({ url, rect: relativeRect, item })
            }
          }
        })
      })
    })
    
    const originalNode = props.appContentRef
    const clonedNode = originalNode.cloneNode(true) as HTMLElement
    
    const hiddenContainer = document.createElement('div')
    hiddenContainer.style.position = 'fixed'
    hiddenContainer.style.left = '-9999px'
    hiddenContainer.style.zIndex = '-1000'
    hiddenContainer.style.width = originalNode.offsetWidth + 'px'
    hiddenContainer.appendChild(clonedNode)
    document.body.appendChild(hiddenContainer)
    
    const currentScale = props.exportScale
    
    exportProgress.value = t('export.syncTheme')
    syncThemeToClonedDoc(hiddenContainer)
    hideExportUIElements(hiddenContainer, { hideCandidates: true, hideUnranked: true })
    processEmptySlots(hiddenContainer)
    
    exportProgress.value = t('export.processingImages')
    await processExportImages(hiddenContainer, currentScale, cropImageWithCanvas, getCorsProxyUrl, applySmartCropToImage, 'pdf')
    
    const originalAppWidth = originalNode.offsetWidth || originalNode.scrollWidth
    configureExportStyles(hiddenContainer, { titleFontSize: props.titleFontSize, originalAppWidth, itemsPerRow: exportItemsPerRow.value || undefined })

    exportProgress.value = t('export.generatingPDF')
    const canvas = await html2canvas(clonedNode, {
      scale: currentScale,
      useCORS: true, 
      allowTaint: false,
      logging: false,
      backgroundColor: getCurrentThemeBackgroundColor(),
      imageTimeout: 15000,
    })
    
    document.body.removeChild(hiddenContainer)
    window.scrollTo(originalScrollX, originalScrollY)
    
    const canvasWidth = canvas.width
    const canvasHeight = canvas.height
    const htmlScaleForPDF = currentScale
    
    const pdfWidth = 210
    const pdfHeight = (canvasHeight / canvasWidth) * pdfWidth
    
    const pdf = new jsPDF({
      orientation: pdfHeight > pdfWidth ? 'portrait' : 'landscape',
      unit: 'mm',
      format: [pdfWidth, pdfHeight],
    })
    
    const imgData = canvas.toDataURL('image/jpeg', 0.9)
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST')
    
    const domWidth = canvasWidth / htmlScaleForPDF
    const domHeight = canvasHeight / htmlScaleForPDF
    const scaleX = pdfWidth / domWidth
    const scaleY = pdfHeight / domHeight
    
    itemLinks.forEach(({ url, rect }) => {
      pdf.link(
        rect.left * scaleX, 
        rect.top * scaleY, 
        rect.width * scaleX, 
        rect.height * scaleY, 
        { url }
      )
    })
    
    exportProgress.value = t('export.downloading')
    pdf.save(`tier-list-${new Date().toISOString().split('T')[0]}.pdf`)
    
    emit('close')
  } catch (error) {
    console.error('导出PDF失败:', error)
    alert(t('export.exportPDFFailed') + (error instanceof Error ? error.message : t('app.unknownError')))
    const containers = document.querySelectorAll('div[style*="left: -9999px"]')
    containers.forEach(c => c.remove())
  } finally {
    isExportingPDF.value = false
    exportProgress.value = ''
  }
}

// 导出为JSON
async function handleExportJSON() {
  try {
    exportProgress.value = t('export.exporting')
    const data = await exportAllData()
    const jsonStr = JSON.stringify(data, null, 2)
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tier-list-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    emit('close')
  } catch (error) {
    console.error('导出失败:', error)
    alert(t('export.exportFailed'))
  } finally {
    exportProgress.value = ''
  }
}

// 跟踪鼠标按下是否在 overlay 上
const mouseDownOnOverlay = ref(false)

function handleOverlayMouseDown(event: MouseEvent) {
  // 检查是否点击在 overlay 上（而不是 modal-content 上）
  mouseDownOnOverlay.value = (event.target as HTMLElement).classList.contains('modal-overlay')
}

function handleOverlayMouseUp(event: MouseEvent) {
  // 导出中不允许关闭
  if (isExportingImage.value || isExportingPDF.value) {
    mouseDownOnOverlay.value = false
    return
  }
  // 只有当 mousedown 和 mouseup 都在 overlay 上时才关闭
  const mouseUpOnOverlay = (event.target as HTMLElement).classList.contains('modal-overlay')
  if (mouseDownOnOverlay.value && mouseUpOnOverlay) {
    emit('close')
  }
  mouseDownOnOverlay.value = false
}

function handleClose() {
  if (isExportingImage.value || isExportingPDF.value) {
    return // 导出中不允许关闭
  }
  emit('close')
}

const isExporting = computed(() => isExportingImage.value || isExportingPDF.value)
</script>

<template>
  <div class="modal-overlay" @mousedown="handleOverlayMouseDown" @mouseup="handleOverlayMouseUp">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">{{ t('export.title') }}</h2>
        <button class="close-btn" @click="handleClose" :disabled="isExporting">×</button>
      </div>
      
      <div class="modal-body">
        <p class="description">{{ t('export.selectFormat') }}</p>

        <div class="export-setting">
          <label class="setting-label">{{ t('export.itemsPerRow') }}</label>
          <div class="setting-control">
            <input
              type="number"
              class="setting-input"
              v-model.number="exportItemsPerRow"
              min="0"
              max="50"
              :placeholder="t('export.itemsPerRowAuto')"
            />
            <span class="setting-hint">{{ exportItemsPerRow > 0 ? exportItemsPerRow + t('export.itemsPerRowUnit') : t('export.itemsPerRowAuto') }}</span>
          </div>
        </div>

        <div class="export-options">
          <button 
            class="export-option" 
            @click="handleExportImage"
            :disabled="isExporting"
          >
            <span class="option-label">{{ t('export.imageLabel') }}</span>
            <span class="option-desc">{{ t('export.imageDesc') }}</span>
          </button>
          
          <button 
            class="export-option" 
            @click="handleExportPDF"
            :disabled="isExporting"
          >
            <span class="option-label">{{ t('export.pdfLabel') }}</span>
            <span class="option-desc">{{ t('export.pdfDesc') }}</span>
          </button>
          
          <button 
            class="export-option" 
            @click="handleExportJSON"
            :disabled="isExporting"
          >
            <span class="option-label">{{ t('export.jsonLabel') }}</span>
            <span class="option-desc">{{ t('export.jsonDesc') }}</span>
          </button>
        </div>
        
        <div v-if="exportProgress" class="progress-message">
          {{ exportProgress }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--modal-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-color);
  border: 2px solid var(--border-color);
  width: 90%;
  max-width: 450px;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  border-bottom: 2px solid var(--border-color);
  background: var(--bg-color);
}

.modal-title {
  font-size: 20px;
  font-weight: bold;
  color: var(--text-color);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-color);
}

.close-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.description {
  color: var(--text-color);
  margin: 0;
  font-weight: bold;
}

.export-setting {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setting-label {
  font-weight: bold;
  color: var(--text-color);
  white-space: nowrap;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.setting-input {
  width: 70px;
  padding: 6px 8px;
  border: 2px solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 14px;
  text-align: center;
}

.setting-hint {
  font-size: 13px;
  color: var(--text-secondary);
}

.export-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.export-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 15px;
  border: 2px solid var(--border-color);
  background: var(--bg-color);
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.export-option:hover:not(:disabled) {
  background: var(--border-color);
  color: var(--bg-color);
}

.export-option:hover:not(:disabled) .option-desc {
  color: var(--bg-color);
  opacity: 0.8;
}

.export-option:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.option-icon {
  font-size: 24px;
  margin-bottom: 5px;
}

.option-label {
  font-size: 16px;
  font-weight: bold;
  color: var(--text-color);
}

.export-option:hover:not(:disabled) .option-label {
  color: var(--bg-color);
}

.option-desc {
  font-size: 12px;
  color: var(--text-color);
  opacity: 0.7;
  margin-top: 2px;
}

.progress-message {
  color: var(--primary-color, #007bff);
  text-align: center;
  font-weight: bold;
  padding: 10px;
  background: var(--bg-light-color, #f8f9fa);
  border-radius: 4px;
}
</style>
