import deepmerge from 'deepmerge'
import {glob} from 'glob'
import {existsSync} from 'node:fs'
import {mkdir, readFile, stat, unlink, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pLimit from 'p-limit'
import prettyBytes from 'pretty-bytes'
import ProgressBar from 'progress'
import {table} from 'table'
import * as tmp from 'tmp-promise'
import {$} from 'zx'

import {Target} from '../types/target.js'
import {Metadata, readMetadata} from './metadata.ts'

const imgExtensions = ['jpg', 'jpeg', 'png']

$.quiet = true

/** Global parameters for image processing. */
type GlobalParams = {
  chromaSubsampling: string
  files: {
    deleteUnknown: boolean
    reprocessExisting: boolean
  }
  inDir: string
  noTable: boolean
  outDir: string
  outMetadata?: string
  preserveMetadata: boolean
  progressive: string
}

/** Definition of a single processing job. */
type ProcessJob = {
  chromaSubsampling: string
  inPath: string
  outPath: string
  parseMetadata: boolean
  preserveMetadata: boolean
  progressive: string
  target: Target
}

/** The results of a processing operation. */
type ProcessResult = {
  inPath: string
  outPath: string
  outSize: string
  ratio: number
  skipped: boolean
  target: string
}

type MetadataPlus = Metadata & Record<string, unknown>

/** The metadata report generated with details on each image. */
type MetadataReport = {
  original: Record<string, MetadataPlus>
  processed: Record<string, {height: number; original: string; width: number}>
}

/**
 * Process many images using one or more target output profiles.
 * @param params Global parameters for image processing
 * @param targets The target output profiles to process images into
 * @returns A promise that resolves when all images have been processed
 */
export async function processMany(params: GlobalParams, targets: Target[]) {
  const pool = pLimit(os.cpus().length)
  const processJobs: ProcessJob[] = []
  const inGlob = path.join(params.inDir, '**', `*.{${imgExtensions.join(',')}}`)
  const inFiles = await glob(inGlob)

  if (inFiles.length === 0) {
    throw new Error(`No images found in \`${params.inDir}\``)
  }

  // Gather jobs
  for (const inPath of inFiles) {
    for (const target of targets) {
      let outPath = path.join(params.outDir, path.relative(params.inDir, inPath))
      const ext = path.extname(outPath)
      const basename = path.basename(outPath, ext)
      outPath = path.join(path.dirname(outPath), `${basename}_${target.name}${ext}`)
      const job: ProcessJob = {
        chromaSubsampling: params.chromaSubsampling,
        inPath,
        outPath,
        parseMetadata: Boolean(params.outMetadata),
        preserveMetadata: params.preserveMetadata,
        progressive: params.progressive,
        target,
      }
      processJobs.push(job)
    }
  }

  // Process all images
  const bar = new ProgressBar('Processing images [:bar] :current/:total :percent :etas', {total: processJobs.length})
  const start = Date.now()

  const processWip = processJobs.map(async (job) => {
    const result = await pool(() => processOne(params, job))
    bar.tick()
    return result
  })
  const processResults = await Promise.all(processWip)
  let skips = ''
  const skipCount = processResults.filter((r) => r.skipped).length
  if (skipCount > 0) skips = `(${skipCount} skipped) `
  const processCount = processResults.length - skipCount
  console.log(`Processed ${processCount} images ${skips}in ${((Date.now() - start) / 1000).toFixed(1)}s`)

  // Build and save metadata report
  if (params.outMetadata) {
    await saveMetadataReport(params.outMetadata, params.inDir, params.outDir, inFiles, processResults)
    console.log(`Saved metadata report to ${params.outMetadata}`)
  }

  // Print results table
  if (!params.noTable) {
    const targetNames = targets.map((t) => t.name)
    processResults.sort(
      (a, b) => a.inPath.localeCompare(b.inPath) || targetNames.indexOf(a.target) - targetNames.indexOf(b.target),
    )
    const cols = ['Output File', 'Size', 'Space Savings']
    const rows = processResults.map((s) => [s.outPath, s.outSize, `${((1 - s.ratio) * 100).toFixed(1)}%`])
    const opts = {drawHorizontalLine: (i: number) => i === 0 || (i - 1) % targets.length === 0}
    console.log(table([cols, ...rows], opts))
  }

  // Delete unknown files
  if (params.files.deleteUnknown) {
    const knownFiles = new Set(processResults.map((r) => r.outPath))
    const allFiles = new Set(await glob(path.join(params.outDir, '**', `*.{${imgExtensions.join(',')}}`)))
    const unknownFiles = [...allFiles].filter((f) => !knownFiles.has(f))
    if (unknownFiles.length > 0) {
      console.log(`Deleting ${unknownFiles.length} unknown files`)
      await Promise.all(
        unknownFiles.map(async (file) => {
          await unlink(file)
          console.log(`  x ${file}`)
        }),
      )
    }
  }
}

/**
 * Process one image using one target output profile.
 * @param params The global parameters for image processing
 * @param job The parameters for the job to process
 * @returns The result of the processing operation
 */
export async function processOne(params: GlobalParams, job: ProcessJob): Promise<ProcessResult> {
  let skipped = true
  if (params.files.reprocessExisting || !existsSync(job.outPath)) {
    skipped = false

    let resizeTo: string | undefined
    if (job.target.maxWidth && job.target.maxHeight) {
      resizeTo = `${job.target.maxWidth}x${job.target.maxHeight}>`
    } else if (job.target.maxWidth) {
      resizeTo = `${job.target.maxWidth}>`
    } else if (job.target.maxHeight) {
      resizeTo = `x${job.target.maxHeight}>`
    }

    await mkdir(path.dirname(job.outPath), {recursive: true})
    await tmp.withFile(async ({path: resized}) => {
      let toCompress = job.inPath
      if (resizeTo) {
        await $`magick ${job.inPath} -quality 100 -resize ${resizeTo} ${resized}`
        toCompress = resized
      }

      await $`cjpegli -d ${job.target.quality} --chroma_subsampling=${job.chromaSubsampling} -p ${job.progressive} ${toCompress} ${job.outPath}`
    })

    await (job.preserveMetadata
      ? $`exiftool -tagsfromfile ${job.inPath} -all:all ${job.outPath} -overwrite_original`
      : $`exiftool -all= ${job.outPath}`)
  }

  const inBytes = (await stat(job.inPath)).size
  const outBytes = (await stat(job.outPath)).size
  return {
    inPath: job.inPath,
    outPath: job.outPath,
    outSize: prettyBytes(outBytes),
    ratio: outBytes / inBytes,
    skipped,
    target: job.target.name,
  }
}

/**
 * Save the metadata report to a file.
 * If an existing report is found, existing values will be preserved and new values will be merged in.
 * @param reportPath The path to the metadata report file
 * @param inDir The directory containing input files
 * @param outDir The directory containing output files
 * @param inFiles The list of input files
 * @param processResults The results of processing the images
 * @returns A promise that resolves when the metadata report is saved
 */
async function saveMetadataReport(
  reportPath: string,
  inDir: string,
  outDir: string,
  inFiles: string[],
  processResults: ProcessResult[],
) {
  const pool = pLimit(os.cpus().length)

  let start = Date.now()
  const metadataWip = inFiles.map(async (inPath) => pool(() => readMetadata(inPath)))
  const results = await Promise.all(metadataWip)
  const metadatas: Record<string, Metadata> = {}
  for (const [i, inPath] of inFiles.entries()) {
    const result = results[i]
    if (result.success) metadatas[inPath] = result.metadata
    else console.error(`Failed to read metadata for ${inPath}: ${result.error}`)
  }

  console.log(`Read metadata for ${inFiles.length} input files in ${((Date.now() - start) / 1000).toFixed(1)}s`)

  const report: MetadataReport = {original: {}, processed: {}}

  const original: Record<string, MetadataPlus> = {}
  for (const [origInPath, metadata] of Object.entries(metadatas)) {
    const inPath = path.relative(inDir, origInPath)
    original[inPath] = metadata
  }

  report.original = original

  start = Date.now()
  const processedJobs = processResults.map(async (result) =>
    pool(async () => {
      const outMeta = await readMetadata(result.outPath)
      if (!outMeta.success) throw new Error(`Failed to read metadata for ${result.outPath}: ${outMeta.error}`)

      const outPath = path.relative(outDir, result.outPath)
      const inPath = path.relative(inDir, result.inPath)

      return {
        metadata: {
          height: outMeta.metadata.height,
          original: inPath,
          width: outMeta.metadata.width,
        },
        outPath,
      }
    }),
  )
  const processedResults = await Promise.all(processedJobs)
  console.log(`Read metadata for ${processResults.length} output files in ${((Date.now() - start) / 1000).toFixed(1)}s`)

  const processed: Record<string, {height: number; original: string; width: number}> = {}
  for (const {metadata, outPath} of processedResults) processed[outPath] = metadata
  report.processed = processed

  let toWrite = report
  try {
    const raw = await readFile(reportPath)
    const parsed = JSON.parse(raw.toString())
    toWrite = deepmerge(report, parsed)
    console.log(`Merged metadata report with existing report at ${reportPath}, preserving existing values`)
  } catch {
    // no existing report, ignore
  }

  await mkdir(path.dirname(reportPath), {recursive: true})
  await writeFile(reportPath, JSON.stringify(toWrite, null, 2))
}
