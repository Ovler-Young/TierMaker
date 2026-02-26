```
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import TierList from './components/TierList.vue'
import SearchModal from './components/SearchModal.vue'
import ConfigModal from './components/ConfigModal.vue'
import EditItemModal from './components/EditItemModal.vue'
import ImportModal from './components/ImportModal.vue'
import ExportModal from './components/ExportModal.vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

import { initConfigStyles, getSetting } from './utils/configManager'
import type { Tier, AnimeItem, TierConfig } from './types'
import { loadTierData, saveTierData, loadTierConfigs, saveTierConfigs, loadThemePreference, saveThemePreference, saveTitle, loadTitle, saveTitleFontSize, loadTitleFontSize, clearItemsAndTitle, importAllData, type ExportData, DEFAULT_TIER_CONFIGS, getDefaultTiers, generateUuid, handleLanguageChange, resetSettings, loadHideItemNames, loadExportScale } from './utils/storage'

const tiers = ref<Tier[]>([])
const unrankedTiers = ref<Tier[]>([{
  id: 'unranked',
  rows: [{
    id: 'unranked-row-0',
    items: []
  }]
}])
const tierConfigs = ref<TierConfig[]>([])
const showSearch = ref(false)
const showConfig = ref(false)
const showEditItem = ref(false)
const showImportModal = ref(false)
const currentTierId = ref<string | null>(null)
const currentRowId = ref<string | null>(null)
const currentIndex = ref<number | null>(null)
const currentEditItem = ref<AnimeItem | null>(null)
const isLongPressEdit = ref(false)
const title = ref<string>('Tier List')
const titleFontSize = ref<number>(32)
const hideItemNames = ref<boolean>(false)
const exportScale = ref<number>(4)
const isDragging = ref(false) // 全局拖动状态
const tierListRef = ref<InstanceType<typeof TierList> | null>(null)
const configModalKey = ref<number>(0) // 用于强制重新渲染 ConfigModal
const topPanelRef = ref<HTMLElement | null>(null)
const bottomPanelRef = ref<HTMLElement | null>(null)
const dividerRef = ref<HTMLElement | null>(null)
const tierListScalerRef = ref<HTMLElement | null>(null)
const topPanelFlex = ref(1)
const bottomPanelFlex = ref(1)
const isResizing = ref(false)
const topPanelHeight = ref(0)
const tierListNaturalHeight = ref(0)

// 计算缩放比例：面板高度 / 内容自然高度
const tierListScale = computed(() => {
  if (tierListNaturalHeight.value <= 0 || topPanelHeight.value <= 0) return 1
  return Math.min(1, topPanelHeight.value / tierListNaturalHeight.value)
})

// 缩放样式：等比缩放 + 宽度补偿（让内容填满面板宽度）
const tierListScaleStyle = computed(() => {
  const s = tierListScale.value
  if (s >= 1) return {}
  return {
    transform: `scale(${s})`,
    transformOrigin: 'top left',
    width: `${100 / s}%`,
  }
})

// 检测重复的条目（根据ID）
const duplicateItemIds = computed(() => {
  const idCount = new Map<string | number, number>()
  
  // 统计每个ID出现的次数
  const allTiers = [...tiers.value, ...unrankedTiers.value]
  allTiers.forEach(tier => {
    tier.rows.forEach(row => {
      row.items.forEach(item => {
        if (item.id) {
          const count = idCount.get(item.id) || 0
          idCount.set(item.id, count + 1)
        }
      })
    })
  })
  
  // 返回出现次数大于1的ID集合
  const duplicates = new Set<string | number>()
  idCount.forEach((count, id) => {
    if (count > 1) {
      duplicates.add(id)
    }
  })
  
  return duplicates
})

// 应用主题设置
function applyTheme(theme: 'light' | 'dark' | 'auto') {
  const html = document.documentElement
  html.setAttribute('data-theme', theme)
}

// 获取当前主题对应的背景色
function getCurrentThemeBackgroundColor(): string {
  // 直接从 CSS 变量读取背景色，确保与页面显示一致
  const computedStyle = getComputedStyle(document.documentElement)
  const bgColor = computedStyle.getPropertyValue('--bg-color').trim()
  
  // 如果成功读取到颜色值，返回它
  if (bgColor) {
    return bgColor
  }
  
  // 如果读取失败，回退到检测主题
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
  
  return '#ffffff' // 默认浅色模式
}

// 初始化主题
function initTheme() {
  const theme = loadThemePreference()
  applyTheme(theme)
  
  // 如果设置为 auto，监听系统主题变化
  if (theme === 'auto') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      // 只有在设置为 auto 时才响应系统变化
      const currentTheme = loadThemePreference()
      if (currentTheme === 'auto') {
        // data-theme 保持为 auto，CSS 会自动响应媒体查询
        applyTheme('auto')
      }
    }
    mediaQuery.addEventListener('change', handleSystemThemeChange)
  }
}



// 加载数据
onMounted(async () => {
  // 初始化配置样式（从 YAML 注入 CSS 变量）
  initConfigStyles()

  initTheme()
  title.value = loadTitle()
  titleFontSize.value = loadTitleFontSize()
  hideItemNames.value = loadHideItemNames()
  exportScale.value = loadExportScale()
  tierConfigs.value = loadTierConfigs()
  
  // Async load
  const allLoadedTiers = await loadTierData()
  
  // Extract Unranked Tier
  const loadedUnranked = allLoadedTiers.find(t => t.id === 'unranked')
  if (loadedUnranked) {
    unrankedTiers.value = [loadedUnranked]
  }
  
  // Assign remaining to tiers (filtering happens later)
  tiers.value = allLoadedTiers.filter(t => t.id !== 'unranked')


  // Hydration: Convert Blobs to ObjectURLs for display
  const allTiersToHydrate = [...tiers.value, ...(unrankedTiers.value || [])]
  allTiersToHydrate.forEach(tier => {
    tier.rows.forEach(row => {
      row.items.forEach(item => {
        if (item.image instanceof Blob) {
           item._blob = item.image
           item.image = URL.createObjectURL(item.image)
        }
        if (item.originalImage instanceof Blob) {
           item.originalImage = URL.createObjectURL(item.originalImage)
        }
      })
    })
  })

  // 数据迁移：将 name_cn 迁移到 name，确保只显示一个名字（优先中文）
  let hasChanges = false
  const migrateItem = (item: AnimeItem) => {
    if (item.name_cn) {
      // 如果有中文名，覆盖 name，并删除 name_cn
      if (item.name !== item.name_cn) {
         item.name = item.name_cn
         hasChanges = true
      }
      delete item.name_cn
      hasChanges = true // 删除属性也算变更
    }
  }

  allTiersToHydrate.forEach(tier => {
    tier.rows.forEach(row => {
      row.items.forEach(item => {
        if (item.id) migrateItem(item)
      })
    })
  })
  
  // 同样迁移 unrankedTiers (虽然这里还没加载，但为了完整性)
  // 注意：unrankedTiers 目前是硬编码初始值，如果后续持久化了也需要迁移
  
  if (hasChanges) {
    await saveTierData([...tiers.value, ...unrankedTiers.value])
  }
  
  // 设置标题的初始内容
  nextTick(() => {
    if (titleRef.value) {
      titleRef.value.textContent = title.value
    }
  })
  
  // 确保 tiers 和 tierConfigs 同步
  const configIds = new Set(tierConfigs.value.map(c => c.id))
  
  // 移除配置中不存在的等级 (且不是 unranked)
  tiers.value = tiers.value.filter(t => configIds.has(t.id))
  
  // 添加配置中存在但 tiers 中不存在的等级
  tierConfigs.value.forEach(config => {
    if (!tiers.value.find(t => t.id === config.id)) {
      tiers.value.push({
        id: config.id,
        rows: [{
          id: `${config.id}-row-0`,
          items: [],
        }],
      })
    }
  })
  
  // 按配置顺序排序
  tiers.value.sort((a, b) => {
    const aOrder = tierConfigs.value.find(c => c.id === a.id)?.order ?? 999
    const bOrder = tierConfigs.value.find(c => c.id === b.id)?.order ?? 999
    return aOrder - bOrder
  })
  
  // 保存同步后的数据
  await saveTierData([...tiers.value, ...unrankedTiers.value])
})

// 可拖拽分隔条逻辑
function handleDividerPointerDown(e: PointerEvent) {
  e.preventDefault()
  isResizing.value = true

  const topPanel = topPanelRef.value
  const bottomPanel = bottomPanelRef.value
  if (!topPanel || !bottomPanel) return

  const startY = e.clientY
  const startTopHeight = topPanel.getBoundingClientRect().height
  const startBottomHeight = bottomPanel.getBoundingClientRect().height
  const totalHeight = startTopHeight + startBottomHeight

  const target = e.target as HTMLElement
  target.setPointerCapture(e.pointerId)

  function onPointerMove(ev: PointerEvent) {
    const delta = ev.clientY - startY
    let newTopHeight = startTopHeight + delta
    let newBottomHeight = startBottomHeight - delta

    const minHeight = 80
    if (newTopHeight < minHeight) {
      newTopHeight = minHeight
      newBottomHeight = totalHeight - minHeight
    }
    if (newBottomHeight < minHeight) {
      newBottomHeight = minHeight
      newTopHeight = totalHeight - minHeight
    }

    topPanelFlex.value = newTopHeight / totalHeight
    bottomPanelFlex.value = newBottomHeight / totalHeight
  }

  function onPointerUp() {
    isResizing.value = false
    target.removeEventListener('pointermove', onPointerMove)
    target.removeEventListener('pointerup', onPointerUp)
  }

  target.addEventListener('pointermove', onPointerMove)
  target.addEventListener('pointerup', onPointerUp)
}

// ResizeObservers 用于实时计算缩放比例
let topPanelObserver: ResizeObserver | null = null
let scalerObserver: ResizeObserver | null = null

onMounted(() => {
  nextTick(() => {
    // 监听上方面板的可用高度
    if (topPanelRef.value) {
      topPanelObserver = new ResizeObserver((entries) => {
        topPanelHeight.value = entries[0].contentRect.height
      })
      topPanelObserver.observe(topPanelRef.value)
    }
    // 监听 tier list 内容的自然高度
    if (tierListScalerRef.value) {
      scalerObserver = new ResizeObserver(() => {
        if (tierListScalerRef.value) {
          tierListNaturalHeight.value = tierListScalerRef.value.scrollHeight
        }
      })
      scalerObserver.observe(tierListScalerRef.value)
    }
  })
})

onUnmounted(() => {
  topPanelObserver?.disconnect()
  scalerObserver?.disconnect()
})

// 监听数据变化，自动保存
watch([tiers, unrankedTiers], async () => {
  await saveTierData([...tiers.value, ...unrankedTiers.value])
}, { deep: true })

function handleAddItem(tierId: string, rowId: string, index: number) {
  currentTierId.value = tierId
  currentRowId.value = rowId
  currentIndex.value = index
  showSearch.value = true
}

function handleSelectAnime(anime: AnimeItem) {
  if (currentTierId.value && currentRowId.value && currentIndex.value !== null) {
    const allTiers = [...tiers.value, ...unrankedTiers.value]
    const tier = allTiers.find(t => t.id === currentTierId.value)
    if (tier) {
      const row = tier.rows.find(r => r.id === currentRowId.value)
      if (row) {
        // 确保数组长度足够
        while (row.items.length <= currentIndex.value) {
          row.items.push({} as AnimeItem)
        }
        row.items[currentIndex.value] = anime
      }
    }
  }
  showSearch.value = false
  currentTierId.value = null
  currentRowId.value = null
  currentIndex.value = null
}

// 批量选择动画（用于导入角色或用户列表）
function handleSelectAnimeMultiple(animes: AnimeItem[]) {
  console.log('[App] handleSelectAnimeMultiple received items:', animes.length)
  // 确保 unrankedTiers 存在
  if (unrankedTiers.value.length === 0) {
    // 应该不会发生，但以防万一
    console.warn('[App] unrankedTiers is empty')
    return
  }
  
  // 修复/清理现有的无效数据（没有 UUID 的项目可能无法渲染）
  // 这解决了之前导入但因缺少 UUID 而“隐形”的问题
  let repairedCount = 0
  unrankedTiers.value.forEach(tier => {
    tier.rows.forEach(row => {
      row.items.forEach(item => {
        if (item.id && !item.uuid) {
          item.uuid = generateUuid()
          repairedCount++
        }
      })
    })
  })
  if (repairedCount > 0) {
    console.log(`[App] Repaired ${repairedCount} existing items with missing UUIDs. They should now be visible.`)
  }
  
  const targetTier = unrankedTiers.value[0]
  if (targetTier.rows.length === 0) {
    targetTier.rows.push({ id: 'unranked-row-0', items: [] })
  }
  const targetRow = targetTier.rows[0]
  
  let addedCount = 0
  
  animes.forEach(anime => {
    // 检查是否已存在（通过 ID）
    const exists = tiers.value.some(t => t.rows.some(r => r.items.some(i => String(i.id) === String(anime.id)))) ||
                  unrankedTiers.value.some(t => t.rows.some(r => r.items.some(i => String(i.id) === String(anime.id))))
    
    if (!exists) {
      // 确保每个导入的项目都有 UUID，否则 TierRow 中的 v-for key 会重复 ('empty-slot')
      if (!anime.uuid) {
        anime.uuid = generateUuid()
      }
      targetRow.items.push(anime)
      addedCount++
    } else {
       console.log(`[App] Skipping duplicate: ${anime.id} (${anime.name})`)
    }
  })
  
  console.log(`[App] Actually added ${addedCount} items. New total in pool: ${targetRow.items.length}`)
  if (addedCount > 0) {
    // 触发保存
    // 注意：watch 会自动处理保存，只要 tiers/unrankedTiers 发生变化
    console.log(`已导入 ${addedCount} 个项目`)
  }
  
  // 批量添加后关闭搜索框
  showSearch.value = false
}

function handleAddRow(tierId: string) {
  const allTiers = [...tiers.value, ...unrankedTiers.value]
  const tier = allTiers.find(t => t.id === tierId)
  if (tier) {
    const newRowId = `${tierId}-row-${tier.rows.length}`
    tier.rows.push({
      id: newRowId,
      items: [],
    })
  }
}

function handleDeleteRow(tierId: string, rowId: string) {
  const allTiers = [...tiers.value, ...unrankedTiers.value]
  const tier = allTiers.find(t => t.id === tierId)
  if (tier && tier.rows.length > 1) {
    const index = tier.rows.findIndex(r => r.id === rowId)
    if (index !== -1) {
      tier.rows.splice(index, 1)
    }
  }
}

function handleDeleteItem(tierId: string, rowId: string, index: number) {
  const allTiers = [...tiers.value, ...unrankedTiers.value]
  const tier = allTiers.find(t => t.id === tierId)
  if (tier) {
    const row = tier.rows.find(r => r.id === rowId)
    if (row) {
      row.items.splice(index, 1)
    }
  }
}





function handleMoveItem(data: {
  fromTierId: string
  fromRowId: string
  toTierId: string
  toRowId: string
  fromIndex: number
  toIndex: number
  item: AnimeItem
}) {
  // 找到源行和目标行
  // 找到源行和目标行
  // 必须重新从所有等级中查找，因为 TierList 组件传出来的 TierId 可能是错的（尤其是在 unranked 和 ranked 之间拖动时）
  const allTiers = [...tiers.value, ...unrankedTiers.value]
  
  // 1. 先通过 RowId 找到真正的 Tier 和 Row
  let realFromTier: Tier | undefined
  let realFromRow: any
  let realToTier: Tier | undefined
  let realToRow: any
  
  for (const t of allTiers) {
    const fRow = t.rows.find(r => r.id === data.fromRowId)
    if (fRow) {
      realFromTier = t
      realFromRow = fRow
    }
    const tRow = t.rows.find(r => r.id === data.toRowId)
    if (tRow) {
      realToTier = t
      realToRow = tRow
    }
  }
  
  if (!realFromTier || !realFromRow || !realToTier || !realToRow) return
  
  // 替换掉 data 中的 TierId
  data.fromTierId = realFromTier.id
  data.toTierId = realToTier.id
  
  const fromRow = realFromRow
  const toRow = realToRow
  
  if (!fromRow || !toRow) return
  
  // 确保源索引有效
  if (data.fromIndex < 0 || data.fromIndex >= fromRow.items.length) {
    return
  }
  
  // 获取要移动的项目
  const itemToMove = fromRow.items[data.fromIndex]
  
  // 如果是跨等级拖动或跨行拖动
  if (data.fromTierId !== data.toTierId || data.fromRowId !== data.toRowId) {
    // 从源行移除
    fromRow.items.splice(data.fromIndex, 1)
    
    // 添加到目标行（确保索引有效，排除空位）
    const targetIndex = Math.min(data.toIndex, toRow.items.length)
    toRow.items.splice(targetIndex, 0, itemToMove)
    
    saveTierData([...tiers.value, ...unrankedTiers.value])
  }
}

function handleReorder(tierId: string, rowId: string, newItems: AnimeItem[]) {

  const allTiers = [...tiers.value, ...unrankedTiers.value]
  const tier = allTiers.find(t => t.id === tierId)
  if (!tier) return
  
  const row = tier.rows.find(r => r.id === rowId)
  if (!row) return
  
  row.items = newItems
  saveTierData([...tiers.value, ...unrankedTiers.value])
}

function handleEditItem(tierId: string, rowId: string, item: AnimeItem, index: number, isLongPress?: boolean) {
  currentTierId.value = tierId
  currentRowId.value = rowId
  currentIndex.value = index
  currentEditItem.value = { ...item } // 创建副本
  isLongPressEdit.value = isLongPress || false
  showEditItem.value = true
}

function handleSaveEditItem(updatedItem: AnimeItem) {
  if (currentTierId.value && currentRowId.value && currentIndex.value !== null) {
    const allTiers = [...tiers.value, ...unrankedTiers.value]
    const tier = allTiers.find(t => t.id === currentTierId.value)
    if (tier) {
      const row = tier.rows.find(r => r.id === currentRowId.value)
      if (row) {
        row.items[currentIndex.value] = updatedItem
        saveTierData([...tiers.value, ...unrankedTiers.value])
      }
    }
  }
  showEditItem.value = false
  currentTierId.value = null
  currentRowId.value = null
  currentIndex.value = null
  currentEditItem.value = null
}

function handleCloseEditItem() {
  showEditItem.value = false
  currentTierId.value = null
  currentRowId.value = null
  currentIndex.value = null
  currentEditItem.value = null
  isLongPressEdit.value = false
}

function handleUpdateConfigs(newConfigs: TierConfig[]) {
  // 1. Identify removed tiers and move their items to Unranked
  const removedTiers = tiers.value.filter(t => !newConfigs.some(c => c.id === t.id))
  
  removedTiers.forEach(tier => {
    tier.rows.forEach(row => {
      if (row.items.length > 0) {
        // Add items to unranked
        unrankedTiers.value[0].rows[0].items.push(...row.items)
      }
    })
  })

  // 2. Construct new tiers array based on newConfigs order
  const newTiers: Tier[] = []
  
  newConfigs.forEach(config => {
    const existingTier = tiers.value.find(t => t.id === config.id)
    
    if (existingTier) {
      // Keep existing tier data (ID is immutable, so no need to update it)
      // Just push it to the new array in the correct order
      newTiers.push(existingTier)
    } else {
      // Create new tier
      newTiers.push({
        id: config.id,
        rows: [{
          id: `${config.id}-row-0`,
          items: [],
        }],
      })
    }
  })

  // 3. Update state
  tierConfigs.value = newConfigs
  saveTierConfigs(newConfigs)
  tiers.value = newTiers

  // Save everything
  saveTierData([...tiers.value, ...unrankedTiers.value])

  // Update UI
  nextTick(() => {
    setTimeout(() => {
      tierListRef.value?.updateLabelWidth()
    }, 100)
  })
}

function handleUpdateTitleFontSize(newFontSize: number) {
  titleFontSize.value = newFontSize
  saveTitleFontSize(newFontSize)
}

function handleUpdateTheme(theme: 'light' | 'dark' | 'auto') {
  applyTheme(theme)
}

function handleUpdateHideItemNames(hide: boolean) {
  hideItemNames.value = hide
}

function handleUpdateExportScale(scale: number) {
  exportScale.value = scale
}

async function handleClearAll() {
  try {
    // 只清空作品数据和标题，保留所有设置
    await clearItemsAndTitle()
    
    // 重置 tiers 为默认结构（清空所有作品）
    tiers.value = tierConfigs.value.map(config => ({
      id: config.id,
      rows: [{
        id: `${config.id}-row-0`,
        items: [],
      }],
    }))
    // 清空备选框
    unrankedTiers.value = [{
      id: 'unranked',
      rows: [{
        id: 'unranked-row-0',
        items: []
      }]
    }]

    await saveTierData([...tiers.value, ...unrankedTiers.value])
    
    // 重置标题和字体大小
    title.value = 'Tier List'
    titleFontSize.value = 32
    saveTitle(title.value)
    saveTitleFontSize(titleFontSize.value)
    
    // 更新标题显示
    nextTick(() => {
      if (titleRef.value) {
        titleRef.value.textContent = title.value
      }
    })
  } catch (error) {
    console.error('清空数据失败:', error)
    alert('清空数据失败，请刷新页面重试')
  }
}

function handleResetSettings() {
  try {
    // 重置所有设置，但保留作品数据和标题
    resetSettings()
    console.log('[App] handleResetSettings triggered')
    
    // 重置评分等级配置 (使用 handleUpdateConfigs 安全地同步，它会处理多余等级的物品归档)
    const defaultConfigs = getDefaultTiers(locale.value)
    handleUpdateConfigs(defaultConfigs)
    
    // 重置标题字体大小
    titleFontSize.value = 32
    saveTitleFontSize(titleFontSize.value)
    
    // 重置主题
    const theme = loadThemePreference()
    applyTheme(theme)
    
    // 重置隐藏作品名（从 config.yaml 读取默认值）
    hideItemNames.value = getSetting('hide-item-names') ?? false
    
    // 重置导出倍率
    exportScale.value = 4
    
    // 注意：不重置标题，保留用户设置的标题
    
    // 重置成功，刷新设置页面内容让用户注意到重置已完成
    if (showConfig.value) {
      // 通过改变 key 强制重新渲染 ConfigModal，实现重新加载内容的效果
      configModalKey.value++
    }
  } catch (error) {
    console.error('重置设置失败:', error)
    alert('重置设置失败，请刷新页面重试')
  }
}

// 监听设置页面关闭，重新计算宽度
watch(showConfig, (newVal, oldVal) => {
  if (oldVal === true && newVal === false) {
    // 设置页面刚关闭
    nextTick(() => {
      setTimeout(() => {
        tierListRef.value?.updateLabelWidth()
      }, 150)
    })
  }
})

const titleRef = ref<HTMLHeadingElement | null>(null)
const isEditingTitle = ref(false)
const appContentRef = ref<HTMLElement | null>(null)
const showExportModal = ref(false)
const showClearConfirm = ref(false)

function handleTitleInput(e: Event) {
  const target = e.target as HTMLHeadingElement
  // 总是更新 title，即使内容为空（允许删除）
  const newTitle = target.textContent?.trim() || ''
  title.value = newTitle || 'Tier List'
  saveTitle(title.value)
}

function handleTitleBlur(e: Event) {
  const target = e.target as HTMLHeadingElement
  isEditingTitle.value = false
  
  // 先保存当前内容
  const newTitle = target.textContent?.trim() || ''
  if (newTitle) {
    title.value = newTitle
    saveTitle(title.value)
  } else {
    // 如果为空，恢复为默认值
    const defaultTitle = 'Tier List'
    title.value = defaultTitle
    target.textContent = defaultTitle
    saveTitle(defaultTitle)
  }
}

function handleTitleFocus() {
  isEditingTitle.value = true
}

// 监听 title 变化，只在非编辑状态下更新 DOM
watch(title, (newTitle) => {
  if (!isEditingTitle.value && titleRef.value) {
    titleRef.value.textContent = newTitle
  }
})



// 处理清空数据点击
function handleClearClick() {
  showClearConfirm.value = true
}

// 确认清空数据
function handleConfirmClear() {
  showClearConfirm.value = false
  handleClearAll()
}

// 取消清空数据
function handleCancelClear() {
  showClearConfirm.value = false
}

function toggleLanguage() {
  const current = locale.value
  const next = current === 'zh' ? 'en' : 'zh'
  handleLanguageChange(next)
  // Reload configs to reflect potential language changes in default tiers
  tierConfigs.value = loadTierConfigs()
  // Force title update if it's default? No, keeps user title.
}

// 导入数据
const fileInputRef = ref<HTMLInputElement | null>(null)

function handleImportClick() {
  showImportModal.value = true
}

// 处理来自 ImportModal 的文件数据导入
async function handleDataImport(data: ExportData) {
  // Confirm overwrite
  if (!confirm('导入数据将覆盖当前所有数据，是否继续？')) {
    return
  }

  try {
     const result = await importAllData(data)
     if (result.success) {
        // Reload data
        title.value = loadTitle()
        tierConfigs.value = loadTierConfigs()
        tiers.value = await loadTierData()
        
        // Hydration logic as before...
        tiers.value.forEach(tier => {
          tier.rows.forEach(row => {
            row.items.forEach(item => {
              if (item.image instanceof Blob) {
                item._blob = item.image
                item.image = URL.createObjectURL(item.image)
              }
              if (item.originalImage instanceof Blob) {
                item.originalImage = URL.createObjectURL(item.originalImage)
              }
            })
          })
        })
        
        // Sync and sort...
        const configIds = new Set(tierConfigs.value.map(c => c.id))
        tiers.value = tiers.value.filter(t => configIds.has(t.id))
        
        tierConfigs.value.forEach(config => {
          if (!tiers.value.find(t => t.id === config.id)) {
            tiers.value.push({
              id: config.id,
              rows: [{
                id: `${config.id}-row-0`,
                items: [],
              }],
            })
          }
        })
        
        tiers.value.sort((a, b) => {
          const aOrder = tierConfigs.value.find(c => c.id === a.id)?.order ?? 999
          const bOrder = tierConfigs.value.find(c => c.id === b.id)?.order ?? 999
          return aOrder - bOrder
        })
        
        nextTick(() => {
          if (titleRef.value) {
            titleRef.value.textContent = title.value
          }
        })
        
        
        showImportModal.value = false // Close modal on success
     } else {
        alert(`${t('app.importFailed')}: ${result.error || t('app.unknownError')}`)
     }
  } catch (error) {
     console.error('导入失败:', error)
     alert(t('app.importError'))
  }
}

// Old handleFileImport can be kept or removed if not used. 
// We will replace the original handleFileImport logic effectively with this.
// But wait, the old one read the file. The new modal reads the file and passes `data`.
// So we need this `handleDataImport`.

function handleFileImport(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  
  const reader = new FileReader()
  reader.onload = async (event) => {
    try {
      const jsonStr = event.target?.result as string
      const data: ExportData = JSON.parse(jsonStr)
      
      // 验证数据格式
      if (!data.tiers || !data.tierConfigs) {
        alert('文件格式不正确')
        return
      }
      
      // 确认导入
      if (confirm('导入数据将覆盖当前所有数据，是否继续？')) {
        const result = await importAllData(data)
        if (result.success) {
          // 重新加载数据
          title.value = loadTitle()
          tierConfigs.value = loadTierConfigs()
          tiers.value = await loadTierData()
          
          // Hydration
          tiers.value.forEach(tier => {
            tier.rows.forEach(row => {
              row.items.forEach(item => {
                if (item.image instanceof Blob) {
                  item._blob = item.image
                  item.image = URL.createObjectURL(item.image)
                }
                if (item.originalImage instanceof Blob) {
                  item.originalImage = URL.createObjectURL(item.originalImage)
                }
              })
            })
          })
          
          // 同步数据
          const configIds = new Set(tierConfigs.value.map(c => c.id))
          tiers.value = tiers.value.filter(t => configIds.has(t.id))
          
          tierConfigs.value.forEach(config => {
            if (!tiers.value.find(t => t.id === config.id)) {
              tiers.value.push({
                id: config.id,
                rows: [{
                  id: `${config.id}-row-0`,
                  items: [],
                }],
              })
            }
          })
          
          tiers.value.sort((a, b) => {
            const aOrder = tierConfigs.value.find(c => c.id === a.id)?.order ?? 999
            const bOrder = tierConfigs.value.find(c => c.id === b.id)?.order ?? 999
            return aOrder - bOrder
          })
          
          // 更新标题显示
          nextTick(() => {
            if (titleRef.value) {
              titleRef.value.textContent = title.value
            }
          })
          
          // 导入成功，无需提示
        } else {
          alert(`导入失败: ${result.error || '未知错误'}`)
        }
      }
    } catch (error) {
      console.error('导入失败:', error)
      alert('文件格式不正确或已损坏')
    }
    
    // 清空文件输入
    if (target) {
      target.value = ''
    }
  }
  reader.readAsText(file)
}

</script>

<template>
  <div class="app" ref="appContentRef">
    <header class="header" :style="{ paddingBottom: `${titleFontSize / 2}px` }">
      <div class="header-left"></div>
      <h1 
        class="title" 
        :style="{ fontSize: `${titleFontSize}px` }"
        contenteditable="true"
        @input="handleTitleInput"
        @blur="handleTitleBlur"
        @focus="handleTitleFocus"
        @keydown.enter.prevent="titleRef?.blur()"
        @keydown.esc.prevent="titleRef?.blur()"
        ref="titleRef"
        :title="t('app.editTitle')"
      ></h1>
      <div class="header-actions">
        <button class="btn btn-secondary" @click="toggleLanguage" :title="t('config.language')">
           {{ locale === 'zh' ? 'English' : '中文' }}
        </button>
        <button 
          class="btn btn-secondary" 
          @click="showExportModal = true"
          :title="t('app.export')"
        >
          {{ t('app.export') }}
        </button>
        <button class="btn btn-secondary" @click="handleImportClick" :title="t('app.import')">
          {{ t('app.import') }}
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".json"
          style="display: none"
          @change="handleFileImport"
        />
        <button class="btn btn-danger" @click="handleClearClick" :title="t('app.clearData')">
          {{ t('app.clearData') }}
        </button>
        <button class="btn btn-secondary" @click="showConfig = true">
          {{ t('app.settings') }}
        </button>
      </div>
    </header>

    <div class="tier-panel-top" ref="topPanelRef" :style="{ flex: topPanelFlex }">
      <div class="tier-list-scaler" ref="tierListScalerRef" :style="tierListScaleStyle">
        <TierList
          ref="tierListRef"
          :tiers="tiers"
          :tier-configs="tierConfigs"
          :is-dragging="isDragging"
          :is-exporting-image="false"
          :duplicate-item-ids="duplicateItemIds"
          :hide-item-names="hideItemNames"
          @add-item="handleAddItem"
          @add-row="handleAddRow"
          @delete-row="handleDeleteRow"
          @delete-item="handleDeleteItem"
          @edit-item="handleEditItem"
          @move-item="handleMoveItem"
          @reorder="handleReorder"
          @drag-start="isDragging = true"
          @drag-end="isDragging = false"
        />
      </div>
    </div>

    <div
      class="divider"
      ref="dividerRef"
      @pointerdown="handleDividerPointerDown"
    ></div>

    <div class="tier-panel-bottom" ref="bottomPanelRef" :style="{ flex: bottomPanelFlex }">
      <TierList
        :tiers="unrankedTiers"
        :tier-configs="[{ id: 'unranked', label: '', color: 'transparent', order: 9999 }]"
        :is-dragging="isDragging"
        :is-exporting-image="false"
        :duplicate-item-ids="duplicateItemIds"
        :hide-item-names="hideItemNames"
        :hide-tier-labels="true"
        @add-item="handleAddItem"
        @add-row="handleAddRow"
        @delete-row="handleDeleteRow"
        @delete-item="handleDeleteItem"
        @edit-item="handleEditItem"
        @move-item="handleMoveItem"
        @reorder="handleReorder"
        @drag-start="isDragging = true"
        @drag-end="isDragging = false"
      />
    </div>



    <SearchModal
      v-if="showSearch"
      @close="showSearch = false"
      @select="handleSelectAnime"
      @select-multiple="handleSelectAnimeMultiple"
    />

    <ConfigModal
      v-if="showConfig"
      :key="configModalKey"
      :configs="tierConfigs"
      @close="showConfig = false"
      @update="handleUpdateConfigs"
      @update-title-font-size="handleUpdateTitleFontSize"
      @update-theme="handleUpdateTheme"
      @update-hide-item-names="handleUpdateHideItemNames"
      @update-export-scale="handleUpdateExportScale"
      @reset-settings="handleResetSettings"
    />
    
    <!-- 清空数据确认弹窗 -->
    <div v-if="showClearConfirm" class="confirm-overlay" @click.self="handleCancelClear">
      <div class="confirm-modal">
        <div class="confirm-header">
          <h3 class="confirm-title">⚠️ 警告</h3>
        </div>
        <div class="confirm-body">
          <p>您确定要清空所有作品吗？</p>
          <p class="confirm-warning">此操作将删除：</p>
          <ul class="confirm-list">
            <li>所有已添加的作品</li>
            <li>标题（恢复为默认标题）</li>
          </ul>
          <p class="confirm-info">⚠️ 注意：此操作不会删除您的设置（主题、导出倍率、评分等级配置等）</p>
          <p class="confirm-danger">此操作不可恢复！</p>
        </div>
        <div class="confirm-footer">
          <button class="btn btn-cancel" @click="handleCancelClear">取消</button>
          <button class="btn btn-danger-confirm" @click="handleConfirmClear">确认清空</button>
        </div>
      </div>
    </div>

    <EditItemModal
      v-if="showEditItem"
      :item="currentEditItem"
      :is-long-press-triggered="isLongPressEdit"
      @close="handleCloseEditItem"
      @save="handleSaveEditItem"
    />

    <ImportModal
      v-if="showImportModal"
      @close="showImportModal = false"
      @import-data="handleDataImport"
      @import-items="handleSelectAnimeMultiple"
    />

    <ExportModal
      v-if="showExportModal"
      :tiers="tiers"
      :tier-configs="tierConfigs"
      :app-content-ref="appContentRef"
      :title="title"
      :title-font-size="titleFontSize"
      :export-scale="exportScale"
      @close="showExportModal = false"
    />
  </div>
</template>

<style scoped>
.app {
  max-width: var(--size-app-max-width, 1400px);
  margin: 0 auto;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tier-panel-top {
  flex: 1;
  overflow: hidden;
  min-height: 80px;
}

.tier-list-scaler {
  width: 100%;
}

.tier-panel-bottom {
  flex: 1;
  overflow-y: auto;
  min-height: 80px;
}

.divider {
  height: 8px;
  background-color: var(--border-color);
  cursor: row-resize;
  flex-shrink: 0;
  position: relative;
  user-select: none;
  touch-action: none;
}

.divider:hover,
.divider:active {
  background-color: var(--text-color);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0;
  border-bottom: var(--size-border-width-thick, 2px) solid var(--border-color);
  position: relative;
  flex-shrink: 0;
}

.header-left {
  flex: 1;
}

.title {
  font-weight: bold;
  color: var(--text-color);
  letter-spacing: 2px;
  cursor: text;
  outline: none;
  transition: opacity 0.2s;
  text-align: center;
  flex: 1;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: fit-content;
}

.title:hover {
  opacity: 0.7;
}

.title:focus {
  opacity: 1;
  border-bottom: 2px dashed var(--border-color);
}

.header-actions {
  display: flex;
  gap: 10px;
}

.btn {
  padding: var(--size-btn-padding-y, 10px) var(--size-btn-padding-x, 20px);
  border: var(--size-border-width-thick, 2px) solid var(--border-color);
  background: var(--bg-color);
  color: var(--text-color);
  font-size: var(--size-btn-font-size, 14px);
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:hover {
  background: var(--border-color);
  color: var(--bg-color);
}

.btn-secondary {
  background: var(--bg-color);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn:disabled:hover {
  background: var(--bg-color);
  color: var(--text-color);
}

.btn-danger {
  background: var(--bg-color);
  color: #cc6666;
  border-color: #cc6666;
}

.btn-danger:hover {
  background: #cc6666;
  color: #ffffff;
}



.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--modal-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.confirm-modal {
  background: var(--bg-color);
  border: var(--size-border-width-modal, 3px) solid var(--border-color);
  width: 90%;
  max-width: var(--size-modal-max-width, 500px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.confirm-header {
  padding: 20px;
  border-bottom: 2px solid var(--border-color);
  background: var(--warning-bg, #fff3cd);
}

.confirm-title {
  font-size: 20px;
  font-weight: bold;
  margin: 0;
  color: #cc6666;
}

.confirm-body {
  padding: var(--size-app-padding, 20px);
}

.confirm-body p {
  margin: 10px 0;
  line-height: 1.6;
  color: var(--text-color);
}

.confirm-warning {
  font-weight: bold;
  color: var(--text-secondary);
  margin-top: 15px !important;
}

.confirm-info {
  font-weight: bold;
  color: #ff9800;
  margin-top: 15px !important;
  font-size: 14px;
}

.confirm-danger {
  font-weight: bold;
  color: #cc6666;
  font-size: 16px;
  margin-top: 15px !important;
}

.confirm-list {
  margin: 10px 0;
  padding-left: 25px;
  line-height: 1.8;
  color: var(--text-color);
}

.confirm-list li {
  margin: 5px 0;
}

.confirm-footer {
  padding: 20px;
  border-top: 2px solid var(--border-color);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel {
  background: var(--bg-color);
  color: var(--text-color);
  border: 2px solid var(--border-color);
}

.btn-cancel:hover {
  background: var(--bg-hover-color, var(--border-color));
}

.btn-danger-confirm {
  background: #cc6666;
  color: #ffffff;
  border-color: #cc6666;
}

.btn-danger-confirm:hover {
  background: #b85555;
  border-color: #b85555;
}
</style>

