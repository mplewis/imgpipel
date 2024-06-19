import {z} from 'zod'
import {$} from 'zx'

/*
Example exiftool output:

exiftool -s -Make -Model -LensInfo -LensMake -LensModel -ExposureTime -FNumber -ISO -DateTimeOriginal -OffsetTimeOriginal some-file.jpg

Make                            : FUJIFILM
Model                           : X-T4
LensInfo                        : 27mm f/2.8
LensMake                        : FUJIFILM
LensModel                       : XF27mmF2.8 R WR
ExposureTime                    : 1/1000
FNumber                         : 8.0
ISO                             : 1250
DateTimeOriginal                : 2024:05:25 15:35:05
OffsetTimeOriginal              : -05:00
*/

export type Metadata = {
  cameraMake?: string
  cameraModel?: string
  date?: Date
  exposureTime?: string
  fNumber?: string
  iso?: string
  lensMake?: string
  lensModel?: string
}

const metadataRe = /^(\w+)\s*:\s(.+)$/
const metadataSchema = z.object({
  DateTimeOriginal: z.string().optional(),
  ExposureTime: z.string().optional(),
  FNumber: z.string().optional(),
  ISO: z.string().optional(),
  LensInfo: z.string().optional(),
  LensMake: z.string().optional(),
  LensModel: z.string().optional(),
  Make: z.string().optional(),
  Model: z.string().optional(),
  OffsetTimeOriginal: z.string().optional(),
})

export function toDate(dto: string, oto: string): {date: Date; success: true} | {error: string; success: false} {
  const dtoRe = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/

  const dtoMatch = dto.match(dtoRe)
  if (!dtoMatch) return {error: 'Could not parse DateTimeOriginal field', success: false}

  const [, year, month, day, hour, minute, second] = dtoMatch
  const ot = oto === '00:00' ? 'Z' : oto

  const iso8601 = `${year}-${month}-${day}T${hour}:${minute}:${second}${ot}`
  const date = new Date(iso8601)
  if (Number.isNaN(date.getTime())) return {error: 'Invalid date', success: false}
  return {date, success: true}
}

export function parseExiftoolMetadata(
  raw: string,
): {error: string; success: false} | {metadata: Metadata; success: true} {
  const lines = raw.split('\n')
  const kv: Record<string, string> = {}
  for (const line of lines) {
    const match = line.match(metadataRe)
    if (!match) continue
    const [, key, value] = match
    kv[key] = value
  }

  if (Object.keys(kv).length === 0) return {error: 'Could not parse metadata', success: false}

  const result = metadataSchema.safeParse(kv)
  if (!result.success) return {error: `Failed to validate metadata: ${result.error.message}`, success: false}
  const {data} = result

  let parsedDate: Date | undefined
  if (data.DateTimeOriginal && data.OffsetTimeOriginal) {
    const dateResult = toDate(data.DateTimeOriginal, data.OffsetTimeOriginal)
    if (dateResult.success) {
      parsedDate = dateResult.date
    } else {
      console.warn(`Failed to parse date (${data.DateTimeOriginal}, ${data.OffsetTimeOriginal}): ${dateResult.error}`)
    }
  }

  const metadata = {
    cameraMake: data.Make,
    cameraModel: data.Model,
    date: parsedDate,
    exposureTime: data.ExposureTime,
    fNumber: data.FNumber,
    iso: data.ISO,
    lensMake: data.LensMake,
    lensModel: data.LensModel,
  }
  return {metadata, success: true}
}

export async function readMetadata(
  inPath: string,
): Promise<{error: string; success: false} | {metadata: Metadata; success: true}> {
  const raw =
    await $`exiftool -s -Make -Model -LensInfo -LensMake -LensModel -ExposureTime -FNumber -ISO -DateTimeOriginal -OffsetTimeOriginal ${inPath}`
  const parseResult = parseExiftoolMetadata(raw.stdout)
  if (!parseResult.success) {
    console.error(raw.stdout)
    console.error(raw.stderr)
    return {error: `Error parsing metadata from ${inPath}: ${parseResult.error}`, success: false}
  }

  return {metadata: parseResult.metadata, success: true}
}
