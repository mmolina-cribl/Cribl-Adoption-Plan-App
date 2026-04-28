import JSZip from 'jszip'

const STATIC_PARTS: readonly string[] = ['xl/styles.xml', 'xl/theme/theme1.xml']

/**
 * Google Sheets renders the topology source table body (sheet4 rows 3+) using the *cellXf* fontId
 * referenced by the cell `s` attribute. In the Cribl shells we’ve seen, those style ids point at
 * 16pt bold fonts. Since we re-apply the shell’s `styles.xml` after ExcelJS writes, we must patch
 * the **output** `styles.xml` to map the source-body style ids back to the 10pt body font.
 *
 * This is done on the final .xlsx bytes (not the on-disk shell).
 */
async function patchTopologySourceBodyFonts(zIn: JSZip, zOut: JSZip) {
  const stylesPath = 'xl/styles.xml'
  const sheetPath = 'xl/worksheets/sheet4.xml'
  const stylesF = zOut.file(stylesPath)
  const sheetF = zIn.file(sheetPath)
  if (!stylesF || !sheetF) {
    return
  }

  const sheetXml = await sheetF.async('string')
  // Rows 3..18 (1-based) cover the "Sources, Volume, Region" table body region in the Cribl template.
  // Collect all `s="N"` style ids used in those rows.
  const styleIds = new Set<number>()
  for (let r = 3; r <= 18; r += 1) {
    const rowRe = new RegExp(`<row\\b[^>]*\\br="${r}"[\\s\\S]*?<\\/row>`, 'm')
    const rowM = sheetXml.match(rowRe)?.[0]
    if (!rowM) {
      continue
    }
    const sRe = /\bs="(\d+)"/g
    let m: RegExpExecArray | null = null
    while ((m = sRe.exec(rowM)) !== null) {
      styleIds.add(Number(m[1]))
    }
  }
  if (styleIds.size === 0) {
    return
  }

  const xml = await stylesF.async('string')
  const cellXfsM = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (!cellXfsM) {
    return
  }
  const xfs = cellXfsM[1].match(/<xf[^/]*?\/>|<xf[\s\S]*?<\/xf>/g) ?? []
  let changed = false
  for (const idx of styleIds) {
    const old = xfs[idx]
    if (!old) {
      continue
    }
    const neu = old
      // Font 0 in the Cribl shells is the 10pt body font (Arial 10 in current shells).
      .replace(/\bfontId="(\d+)"/g, 'fontId="0"')
      .replace(/\bapplyFont="0"/g, 'applyFont="1"')
    if (neu !== old) {
      xfs[idx] = neu
      changed = true
    }
  }
  if (!changed) {
    return
  }
  const rebuilt = xml.replace(
    /(<cellXfs\b[^>]*>)[\s\S]*?(<\/cellXfs>)/,
    (_full, g1, g2) => `${g1}${xfs.join('')}${g2}`,
  )
  zOut.file(stylesPath, rebuilt)
}

/**
 * Cribl v0.8.6 topology uses `tableStyleInfo` in `table1`/`table2` pointing at custom `tableStyles` + `dxf`
 * in `styles.xml` (row striping). ExcelJS rewrites `xl/tables/*.xml` and drops that link.
 */
function listTableXmlPaths(z: JSZip): string[] {
  return Object.keys(z.files)
    .filter((k) => !z.files[k].dir && /^xl\/tables\/table\d+\.xml$/.test(k))
    .sort()
}

/**
 * Overwrite with the **import shell**’s `tableN.xml` but keep the `ref` range that ExcelJS computed
 * (e.g. after extra source / WG rows) so the table still covers the written cells.
 */
async function mergeTableXmlsFromOriginal(zIn: JSZip, zOut: JSZip) {
  for (const p of listTableXmlPaths(zIn)) {
    const fIn = zIn.file(p)
    if (!fIn) {
      continue
    }
    const origS = await fIn.async('string')
    const outF = zOut.file(p)
    if (!outF) {
      zOut.file(p, origS)
      continue
    }
    const outS = await outF.async('string')
    const m = outS.match(/<table\b[^>]+?\bref="([^"]*)"/)
    const newRef = m?.[1]
    if (newRef) {
      const merged = origS.replace(
        /(<table\b[^>]+?)\bref="[^"]*"/,
        (_full, g1) => `${g1}ref="${newRef}"`,
      )
      zOut.file(p, merged)
    } else {
      zOut.file(p, origS)
    }
  }
}

/**
 * Source summary + Copy of Sources and WGs rely on the **tail** of the worksheet XML: `autoFilter`,
 * `mergeCells`, `conditionalFormatting` (colorScale / dxf rules), and `dataValidations`. ExcelJS
 * often drops or shortens that tail when saving. Keep the **import shell**’s non-data section and
 * swap in the **filled** `<sheetData>...</sheetData>`.
 */
const WORKSHEETS_SHEET_DATA_SPLICE: readonly string[] = [
  'xl/worksheets/sheet2.xml', // Source summary
  'xl/worksheets/sheet4.xml', // Copy of Sources and WGs
]

function mergeSheetDataRestFromOriginal(
  path: string,
  originalXml: string,
  filledXml: string,
  zOut: JSZip,
): void {
  const outData = filledXml.match(/<sheetData[^>]*>[\s\S]*?<\/sheetData>/)?.[0]
  if (!outData) {
    return
  }
  const d0 = originalXml.indexOf('<sheetData')
  if (d0 < 0) {
    return
  }
  const d1 = originalXml.indexOf('</sheetData>')
  if (d1 < 0) {
    return
  }
  const endTag = '</sheetData>'
  const dataEnd = d1 + endTag.length
  let origPre = originalXml.slice(0, d0)
  const origPost = originalXml.slice(dataEnd)

  const dim = filledXml.match(/<dimension[^/]+\/>/)
  if (dim) {
    if (origPre.match(/<dimension[^/]+\/>/)) {
      origPre = origPre.replace(/<dimension[^/]+\/>/, dim[0])
    }
  }
  const merged = `${origPre}${outData}${origPost}`
  zOut.file(path, merged)
}

async function mergeWorksheetTailsFromOriginal(zIn: JSZip, zOut: JSZip) {
  for (const path of WORKSHEETS_SHEET_DATA_SPLICE) {
    const a = zIn.file(path)
    const b = zOut.file(path)
    if (!a || !b) {
      continue
    }
    const originalXml = await a.async('string')
    const filledXml = await b.async('string')
    mergeSheetDataRestFromOriginal(path, originalXml, filledXml, zOut)
  }
}

function toUint8(x: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (x instanceof ArrayBuffer) {
    return new Uint8Array(x)
  }
  return new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
}

/**
 * After ExcelJS has written plan data, re-apply OOXML that ExcelJS mangles: full `styles.xml` +
 * theme, table definitions with Cribl `tableStyleInfo`, and worksheet `conditionalFormatting` /
 * `dataValidations` / `tableParts` tails for the two modeled sheets.
 */
export async function mergeOoxmlStylePartsFromOriginal(
  filledXlsx: ArrayBuffer | ArrayBufferView,
  originalXlsx: ArrayBuffer,
): Promise<ArrayBuffer> {
  const u8 = toUint8(filledXlsx)
  const zOut = await JSZip.loadAsync(u8)
  const zIn = await JSZip.loadAsync(new Uint8Array(originalXlsx))
  for (const p of STATIC_PARTS) {
    const f = zIn.file(p)
    if (f) {
      const raw = await f.async('uint8array')
      zOut.file(p, raw)
    }
  }
  await mergeTableXmlsFromOriginal(zIn, zOut)
  await mergeWorksheetTailsFromOriginal(zIn, zOut)
  await patchTopologySourceBodyFonts(zIn, zOut)
  const ab = await zOut.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
  return ab as ArrayBuffer
}
