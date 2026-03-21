import * as XLSX from 'xlsx'

export function sanitizeExcelFilename(name: string): string {
  const trimmed = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  return trimmed || 'dışa_aktarım'
}

/**
 * Nesne dizisini .xlsx olarak indirir (tarayıcı).
 */
export function exportRowsToExcel(
  rows: Record<string, string | number | boolean | undefined>[],
  filename: string,
  sheetName = 'Sayfa1'
): boolean {
  if (!rows.length) return false
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  const safeSheet = sheetName.replace(/[:\\/?*[\]]/g, '').slice(0, 31) || 'Sayfa1'
  XLSX.utils.book_append_sheet(wb, ws, safeSheet)
  const base = sanitizeExcelFilename(filename.replace(/\.xlsx$/i, ''))
  XLSX.writeFile(wb, `${base}.xlsx`)
  return true
}
