/**
 * 导出工具函数
 * 用于图片和 PDF 导出时的公共逻辑
 */

import type { CropPosition } from '../types'
import { getSize } from './configManager'

// 会话级图片缓存：key = `${originalSrc}|${scale}`，value = 裁剪后的 data URL
// 避免每次导出重复下载和处理同一张图片
const exportImageCache = new Map<string, string>()

/**
 * 处理克隆文档中的所有图片，应用 CORS 代理和裁剪
 */
export async function processExportImages(
    root: HTMLElement,
    scale: number,
    cropImageFn: (img: HTMLImageElement, scale: number) => Promise<string | null>,
    getCorsProxyUrlFn: (url: string) => string,
    applySmartCropFn: (img: HTMLImageElement) => void,
    exportType: 'image' | 'pdf' = 'image',
    options?: { excludeCandidates?: boolean }
): Promise<void> {
    const { excludeCandidates = true } = options || {}

    const allImages = root.querySelectorAll('img') as NodeListOf<HTMLImageElement>
    const imageProcessPromises: Promise<void>[] = []

    // 排除底部面板（unranked 区域）中的图片
    const bottomPanel = excludeCandidates ? root.querySelector('.tier-panel-bottom') : null

    allImages.forEach((img) => {
        // 跳过底部待排序区域的图片
        if (bottomPanel && bottomPanel.contains(img)) {
            return
        }
        const processPromise = new Promise<void>(async (resolve) => {
            const itemId = img.getAttribute('data-item-id')
            const currentSrc = img.src
            const dataOriginalSrc = img.getAttribute('data-original-src')

            // 如果 currentSrc 已经是 data URL（主页面已裁剪），直接使用
            if (currentSrc.startsWith('data:')) {
                const width = getSize('image-width') || 100
                const height = getSize('image-height') || 133
                img.style.width = `${width}px`
                img.style.height = `${height}px`
                img.style.objectFit = 'none'
                resolve()
                return
            }

            // 优先检测 blob，如果当前图片是 blob (本地上传)，它是最高清晰度且无需代理
            const isBlob = currentSrc.startsWith('blob:')
            const originalSrc = isBlob ? currentSrc : (dataOriginalSrc || currentSrc)

            // 命中缓存：直接使用上次导出处理好的 data URL，无需重新下载
            const cacheKey = `${originalSrc}|${scale}`
            if (exportImageCache.has(cacheKey)) {
                const cached = exportImageCache.get(cacheKey)!
                img.src = cached
                const width = getSize('image-width') || 100
                const height = getSize('image-height') || 133
                img.style.width = `${width}px`
                img.style.height = `${height}px`
                img.style.objectFit = 'none'
                img.style.position = 'static'
                img.style.left = 'auto'
                img.style.top = 'auto'
                img.style.transform = 'none'
                resolve()
                return
            }

            // 替换为 CORS 代理 URL
            if (originalSrc && !originalSrc.startsWith('data:') && !originalSrc.startsWith('blob:') && !originalSrc.includes('wsrv.nl')) {
                const proxyUrl = getCorsProxyUrlFn(originalSrc)
                const isVndbImage = originalSrc.includes('vndb.org')

                if (!isVndbImage || proxyUrl !== originalSrc) {
                    img.crossOrigin = 'anonymous'
                }
                img.src = proxyUrl
            } else if (originalSrc?.includes('wsrv.nl') || originalSrc?.includes('i0.wp.com') || originalSrc?.startsWith('blob:')) {
                img.crossOrigin = 'anonymous'
            } else {
                console.warn(`⚠️ 导出${exportType === 'pdf' ? ' PDF' : '图片'}时 URL 异常:`, { originalSrc, currentSrc: img.src, itemId })
            }

            // 等待图片加载完成
            const waitForLoad = () => {
                if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
                    img.onload = null
                    img.onerror = null

                    cropImageFn(img, scale).then((croppedBase64) => {
                        const width = getSize('image-width') || 100
                        const height = getSize('image-height') || 133

                        if (croppedBase64) {
                            // 存入缓存，下次导出直接复用
                            exportImageCache.set(cacheKey, croppedBase64)
                            img.src = croppedBase64
                            img.style.width = `${width}px`
                            img.style.height = `${height}px`
                            img.style.objectFit = 'none'
                        } else {
                            applySmartCropFn(img)
                        }
                    }).catch((error) => {
                        console.error(`❌ 导出${exportType === 'pdf' ? ' PDF' : '图片'}时裁剪出错:`, { itemId, error })
                        applySmartCropFn(img)
                    }).finally(() => {
                        img.style.position = 'static'
                        img.style.left = 'auto'
                        img.style.top = 'auto'
                        img.style.transform = 'none'
                        resolve()
                    })
                } else {
                    img.onload = () => waitForLoad()
                    img.onerror = () => {
                        console.error(`❌ 导出${exportType === 'pdf' ? ' PDF' : '图片'}时加载失败:`, { itemId, src: img.src, originalSrc })
                        resolve()
                    }
                }
            }

            waitForLoad()
        })

        imageProcessPromises.push(processPromise)
    })

    await Promise.allSettled(imageProcessPromises)
}

/**
 * 处理克隆文档中的空位元素
 */
export function processEmptySlots(root: HTMLElement): void {
    const emptySlots = root.querySelectorAll('.tier-item.empty')
    emptySlots.forEach((slot) => {
        const el = slot as HTMLElement
        const parent = el.parentElement
        const hasItems = parent && Array.from(parent.children).some(c => !c.classList.contains('empty'))

        if (hasItems) {
            el.style.display = 'none'
        } else {
            el.style.opacity = '0'
            el.style.border = 'none'
            const content = el.querySelectorAll('.item-placeholder, .placeholder-text')
            content.forEach(c => (c as HTMLElement).style.display = 'none')
        }
    })
}

/**
 * 配置导出时的 DOM 样式
 */
export function configureExportStyles(
    root: HTMLElement,
    options: {
        titleFontSize: number
        originalAppWidth: number
        itemsPerRow?: number
    }
): void {
    const { titleFontSize, originalAppWidth, itemsPerRow } = options

    // 确保 Header 样式正确
    const header = root.querySelector('.header') as HTMLElement
    if (header) {
        header.style.paddingBottom = `${titleFontSize / 2}px`
        header.style.marginBottom = '0'
    }

    // 确保标题正常显示
    const clonedTitle = root.querySelector('.title') as HTMLElement
    if (clonedTitle) {
        clonedTitle.style.display = 'block'
        clonedTitle.style.visibility = 'visible'
        clonedTitle.style.position = 'relative'
        clonedTitle.style.left = 'auto'
        clonedTitle.style.transform = 'none'
        clonedTitle.style.textAlign = 'center'
        clonedTitle.style.width = '100%'
        clonedTitle.style.margin = '0'
        clonedTitle.style.padding = '0'
        clonedTitle.style.lineHeight = '1'
    }

    // 设置 tier-list 的顶部间距
    const clonedTierList = root.querySelector('.tier-list') as HTMLElement
    if (clonedTierList) {
        clonedTierList.style.marginTop = '0'
        clonedTierList.style.paddingTop = '0'
    }

    // 重置上方面板：移除 overflow:hidden 和 flex 限制，让内容自然撑开
    const topPanel = root.querySelector('.tier-panel-top') as HTMLElement
    if (topPanel) {
        topPanel.style.flex = 'none'
        topPanel.style.overflow = 'visible'
        topPanel.style.height = 'auto'
        topPanel.style.minHeight = '0'
    }

    // 重置 scaler：移除缩放 transform，以全尺寸导出
    const scaler = root.querySelector('.tier-list-scaler') as HTMLElement
    if (scaler) {
        scaler.style.transform = 'none'
        scaler.style.width = '100%'
    }

    // Tight 模式：移除所有留白；重置 app 的高度约束
    const clonedApp = root.querySelector('.app') as HTMLElement
    if (clonedApp) {
        clonedApp.style.padding = '0'
        clonedApp.style.margin = '0'
        clonedApp.style.width = `${originalAppWidth}px`
        clonedApp.style.maxWidth = `${originalAppWidth}px`
        clonedApp.style.height = 'auto'
        clonedApp.style.overflow = 'visible'
    }

    // 每行番数：固定 .tier-row 宽度，使内容按指定列数换行
    if (itemsPerRow && itemsPerRow > 0) {
        const itemWidth = Number(getSize('item-width')) || 100
        const gap = Number(getSize('row-gap')) || 10
        const padding = Number(getSize('row-padding')) || 10
        const rowWidth = itemsPerRow * itemWidth + (itemsPerRow - 1) * gap + 2 * padding

        root.querySelectorAll('.tier-row').forEach((el) => {
            const row = el as HTMLElement
            row.style.width = `${rowWidth}px`
            row.style.flex = 'none'
        })

        // 获取标签列宽度（从 inline style 或实测宽度）
        const labelEl = root.querySelector('.tier-label') as HTMLElement
        const labelWidth = labelEl
            ? (parseFloat(labelEl.style.width) || labelEl.offsetWidth || Number(getSize('label-min-width')) || 80)
            : 0

        const exportAppWidth = labelWidth + rowWidth
        if (clonedApp) {
            clonedApp.style.width = `${exportAppWidth}px`
            clonedApp.style.maxWidth = `${exportAppWidth}px`
        }
    }
}

/**
 * 隐藏导出时不需要的 UI 元素
 */
export function hideExportUIElements(
    root: HTMLElement,
    options?: { hideCandidates?: boolean; hideUnranked?: boolean }
): void {
    const { hideCandidates = true, hideUnranked = false } = options || {}

    // 隐藏按钮和操作栏
    root.querySelectorAll('button, .btn, .header-actions').forEach((el: any) => el.style.display = 'none')

    const headerLeft = root.querySelector('.header-left') as HTMLElement
    if (headerLeft) {
        headerLeft.style.display = 'none'
    }

    // 隐藏模态框
    const modals = root.querySelectorAll('.modal-overlay, [class*="modal"]')
    modals.forEach((modal) => {
        (modal as HTMLElement).style.display = 'none'
    })

    // 隐藏候选框
    if (hideCandidates) {
        const candidatesBox = root.querySelector('.candidates-box') as HTMLElement
        if (candidatesBox) {
            candidatesBox.style.display = 'none'
            candidatesBox.style.visibility = 'hidden'
            candidatesBox.style.height = '0'
            candidatesBox.style.margin = '0'
            candidatesBox.style.padding = '0'
            candidatesBox.style.overflow = 'hidden'
        }
    }

    // 隐藏无等级列表和分割线
    if (hideUnranked) {
        // 新布局：直接隐藏底部面板和分隔条
        const bottomPanel = root.querySelector('.tier-panel-bottom') as HTMLElement
        if (bottomPanel) {
            bottomPanel.style.display = 'none'
        }
        root.querySelectorAll('.divider').forEach((el) => {
            (el as HTMLElement).style.display = 'none'
        })
    }
}

/**
 * 同步主题到克隆文档
 */
/**
 * 同步主题到克隆节点 (Since we are in same doc, we might just look up root)
 * Not strictly needed if we clone styles, but good to set attribute on container if usage depends on it.
 * But wait, data-theme is on html. We should set it on the container if we want scoped styles? 
 * Or just rely on global? 
 * Actually, let's just make it a no-op or set on container if needed.
 * But CSS variables are usually on :root. 
 * If we are cloning inside the SAME document, the root :root variables apply.
 * So we don't need to do anything for CSS vars.
 * But specific selectors like [data-theme="dark"] .foo might need the attribute on a parent.
 * Let's set it on the root element.
 */
export function syncThemeToClonedDoc(root: HTMLElement): void {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'auto'
    root.setAttribute('data-theme', currentTheme)
}
