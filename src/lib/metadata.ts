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
ImageWidth                      : 5970
ImageHeight                     : 3980
*/

/** Metadata gathered from an image. */
export type Metadata = {
  cameraMake?: string
  cameraModel?: string
  date?: Date
  exposureTime?: string
  fNumber?: string
  height: number
  iso?: string
  lensMake?: string
  lensModel?: string
  width: number
}

/** Regex to parse exiftool output lines. */
const metadataRe = /^(\w+)\s*:\s(.+)$/

/** Schema to gather metadata key/values. */
const metadataSchema = z.object({
  DateTimeOriginal: z.string().optional(),
  ExposureTime: z.string().optional(),
  FNumber: z.string().optional(),
  ISO: z.string().optional(),
  ImageHeight: z.coerce.number().int(),
  ImageWidth: z.coerce.number().int(),
  LensInfo: z.string().optional(),
  LensMake: z.string().optional(),
  LensModel: z.string().optional(),
  Make: z.string().optional(),
  Model: z.string().optional(),
  OffsetTimeOriginal: z.string().optional(),
})

/**
 * Convert a DateTimeOriginal and OffsetTimeOriginal to a Date.
 * @param dto DateTimeOriginal field from EXIF data
 * @param oto OffsetTimeOriginal field from EXIF data
 * @returns Date if successful, error message if not
 */
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

/**
 * Parse exiftool raw output into a Metadata object.
 * @param raw The raw output from exiftool
 * @returns Metadata object on success, error message otherwise
 */
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
    height: data.ImageHeight,
    iso: data.ISO,
    lensMake: data.LensMake,
    lensModel: data.LensModel,
    width: data.ImageWidth,
  }
  return {metadata, success: true}
}

/**
 * Read metadata from an image file.
 * @param inPath Path to the image file
 * @returns Metadata on success, error message otherwise
 */
export async function readMetadata(
  inPath: string,
): Promise<{error: string; success: false} | {metadata: Metadata; success: true}> {
  $.quiet = true

  const raw =
    await $`exiftool -s -DateTimeOriginal -ExposureTime -FNumber -ISO -ImageHeight -ImageWidth -LensInfo -LensMake -LensModel -Make -Model -OffsetTimeOriginal ${inPath}`
  const parseResult = parseExiftoolMetadata(raw.stdout)
  if (!parseResult.success)
    return {error: `Error parsing metadata from ${inPath}: ${parseResult.error}`, success: false}

  return {metadata: parseResult.metadata, success: true}
}
