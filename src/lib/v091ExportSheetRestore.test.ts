import { describe, expect, it } from 'vitest'
import {
  extendPerWgSourceBandSqrefAttribute,
  extendPerWgWorksheetDataBandSqrefs,
  insertMissingCells,
  overlayCellsInSheet,
} from './v091ExportSheetRestore'

describe('insertMissingCells', () => {
  it('splices new cells into an existing row when the row is present', () => {
    const xml =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" s="1"/></row>' +
      '<row r="2"><c r="A2" s="1"/></row>' +
      '</sheetData></worksheet>'
    const out = insertMissingCells(xml, [['B2', 'hello']])
    expect(out).toContain('<row r="2">')
    expect(out).toContain('hello')
    expect(out).toMatch(/<row r="2"[^>]*>[\s\S]*<c r="B2"/)
  })

  it('appends a new row after row 21 and copies per-column s= from gold scaffold row 21', () => {
    const xml =
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' +
      '<row r="20"><c r="A20" s="5"/></row>' +
      '<row r="21"><c r="A21" s="77"/><c r="B21" s="88"/></row>' +
      '</sheetData></worksheet>'
    const out = insertMissingCells(xml, [
      ['A22', 's22'],
      ['B22', 't22'],
    ])
    expect(out).toContain('<row r="22">')
    expect(out).toContain('<c r="A22" s="77"')
    expect(out).toContain('<c r="B22" s="88"')
    expect(out).toContain('s22')
    expect(out).toContain('t22')
    expect(out.indexOf('<row r="21">')).toBeLessThan(out.indexOf('<row r="22">'))
  })

  it('copies row-level attrs from scaffold row 21 onto appended rows', () => {
    const xml =
      '<worksheet><sheetData>' +
      '<row r="21" ht="18" customHeight="1"><c r="A21" s="9"/></row>' +
      '</sheetData></worksheet>'
    const out = insertMissingCells(xml, [['A22', 'x']])
    expect(out).toContain('<row r="22" ht="18" customHeight="1">')
    expect(out).toContain('<c r="A22" s="9"')
  })

  it('does not apply scaffold styles for new rows at or before row 21 (non–per-WG sheets)', () => {
    const xml =
      '<worksheet><sheetData>' +
      '<row r="21"><c r="A21" s="99"/></row>' +
      '</sheetData></worksheet>'
    const out = insertMissingCells(xml, [['A3', 'early']])
    expect(out).toMatch(/<row r="3">/)
    expect(out).toMatch(/<c r="A3" t="inlineStr"/)
    expect(out).not.toMatch(/<c r="A3"[^>]*\bs="/)
  })

  it('inserts consecutive new rows in ascending order', () => {
    const xml =
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1"/></row>' +
      '</sheetData></worksheet>'
    const out = insertMissingCells(xml, [
      ['A3', 'r3'],
      ['A2', 'r2'],
    ])
    expect(out).toContain('<row r="2">')
    expect(out).toContain('<row r="3">')
    const i2 = out.indexOf('<row r="2">')
    const i3 = out.indexOf('<row r="3">')
    expect(i2).toBeLessThan(i3)
  })

  it('overlayCellsInSheet emits empty styled cells beyond row 21 when per-WG flag is set', () => {
    const goldXml =
      '<worksheet><sheetData>' +
      '<row r="21"><c r="A21" s="11"/><c r="B21" s="22"/><c r="C21" s="33"/></row>' +
      '</sheetData></worksheet>'
    const overlay = new Map<string, string | null>([
      ['A22', 'filled'],
      ['B22', null],
      ['C22', null],
    ])
    const out = overlayCellsInSheet(goldXml, [], overlay, new Set(), true)
    expect(out).toContain('<c r="A22" s="11"')
    expect(out).toContain('<c r="B22" s="22"/>')
    expect(out).toContain('<c r="C22" s="33"/>')
  })
})

describe('extendPerWgSourceBandSqrefAttribute', () => {
  it('extends rects ending at row 21 with top >= 3 when lastDataRow > 21', () => {
    expect(extendPerWgSourceBandSqrefAttribute('G3:G21', 25)).toBe('G3:G25')
    expect(extendPerWgSourceBandSqrefAttribute('P3:R21', 30)).toBe('P3:R30')
  })

  it('extends multiple space-separated areas', () => {
    expect(extendPerWgSourceBandSqrefAttribute('M3:M21 AC3:AC21', 22)).toBe('M3:M22 AC3:AC22')
  })

  it('leaves header ranges, single cells, and non-scaffold bands unchanged', () => {
    expect(extendPerWgSourceBandSqrefAttribute('A1:D1', 25)).toBe('A1:D1')
    expect(extendPerWgSourceBandSqrefAttribute('A3', 25)).toBe('A3')
    expect(extendPerWgSourceBandSqrefAttribute('B1', 25)).toBe('B1')
    expect(extendPerWgSourceBandSqrefAttribute('E3:E21', 21)).toBe('E3:E21')
  })
})

describe('extendPerWgWorksheetDataBandSqrefs', () => {
  it('rewrites sqref inside dataValidations and conditionalFormatting', () => {
    const xml =
      '<worksheet>' +
      '<dataValidations count="1">' +
      '<dataValidation sqref="G3:G21" type="list"/>' +
      '</dataValidations>' +
      '<conditionalFormatting sqref="H3:J21"><cfRule/></conditionalFormatting>' +
      '</worksheet>'
    const out = extendPerWgWorksheetDataBandSqrefs(xml, 24)
    expect(out).toContain('sqref="G3:G24"')
    expect(out).toContain('sqref="H3:J24"')
  })
})
