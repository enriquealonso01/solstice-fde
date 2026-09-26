import type { Property } from '../../../shared/types'

/** Parses the properties CSV into the records written to data/generated/properties.json. */
export function propertiesFromCsv(csvText: string): Property[]
