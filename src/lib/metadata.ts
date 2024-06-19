import {z} from 'zod'

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
  cameraMake: string
  cameraModel: string
  date: Date
  exposureTime: string
  fNumber: string
  iso: string
  lensMake: string
  lensModel: string
}

const metadataRe = /^(\w+)\s*:\s(.+)$/
const metadataSchema = z.object({
  DateTimeOriginal: z.string(),
  ExposureTime: z.string(),
  FNumber: z.string(),
  ISO: z.string(),
  LensInfo: z.string(),
  LensMake: z.string(),
  LensModel: z.string(),
  Make: z.string(),
  Model: z.string(),
  OffsetTimeOriginal: z.string(),
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
  if (!result.success) return {error: result.error.message, success: false}
  const {data} = result

  const dateResult = toDate(data.DateTimeOriginal, data.OffsetTimeOriginal)
  if (!dateResult.success) return dateResult

  const metadata = {
    cameraMake: data.Make,
    cameraModel: data.Model,
    date: dateResult.date,
    exposureTime: data.ExposureTime,
    fNumber: data.FNumber,
    iso: data.ISO,
    lensMake: data.LensMake,
    lensModel: data.LensModel,
  }
  return {metadata, success: true}
}
