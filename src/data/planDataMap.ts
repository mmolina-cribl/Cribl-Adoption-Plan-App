/** What the packaged download is for (customer-facing copy in the overview). */
export const xlsxSheets: { name: string; role: string }[] = [
  { name: 'INSTRUCTIONS', role: 'Orientation and how to file the plan with your team.' },
  { name: 'Source summary', role: 'One row per data source with the details you enter here.' },
  { name: 'input_data', role: 'Static picklist values for Excel data validation (same for every export).' },
  { name: 'Copy of Sources and WGs', role: 'How much data, where it runs, and worker capacity in one place.' },
]
