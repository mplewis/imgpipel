import {glob} from 'glob'
import {mkdir, stat} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pLimit from 'p-limit'
import prettyBytes from 'pretty-bytes'
import ProgressBar from 'progress'
import {table} from 'table'
import * as tmp from 'tmp-promise'
import {$} from 'zx'

import {Target} from '../types/target.js'
import {Metadata, parseExiftoolMetadata} from './metadata.ts'

const imgExtensions = ['jpg', 'jpeg', 'png']

// $.verbose = true
$.quiet = true

type GlobalParams = {
  chromaSubsampling: string
  inDir: string
  outDir: string
  outMetadata?: string
  preserveMetadata: boolean
  progressive: string
}

type Job = {
  chromaSubsampling: string
  inPath: string
  outPath: string
  parseMetadata: boolean
  preserveMetadata: boolean
  progressive: string
  target: Target
}

export async function processMany(params: GlobalParams, targets: Target[]) {
  const pool = pLimit(os.cpus().length)
  const jobs: Job[] = []
  const inGlob = path.join(params.inDir, '**', `*.{${imgExtensions.join(',')}}`)
  const inFiles = await glob(inGlob)

  if (inFiles.length === 0) {
    throw new Error(`No images found in \`${params.inDir}\``)
  }

  for (const inPath of inFiles) {
    for (const target of targets) {
      let outPath = path.join(params.outDir, path.relative(params.inDir, inPath))
      const ext = path.extname(outPath)
      const basename = path.basename(outPath, ext)
      outPath = path.join(path.dirname(outPath), `${basename}_${target.name}${ext}`)
      const job: Job = {
        chromaSubsampling: params.chromaSubsampling,
        inPath,
        outPath,
        parseMetadata: Boolean(params.outMetadata),
        preserveMetadata: params.preserveMetadata,
        progressive: params.progressive,
        target,
      }
      jobs.push(job)
    }
  }

  // TODO: Don't regenerate existing files (with flag)
  // TODO: Delete mismatched files (with flag)

  const bar = new ProgressBar('Processing images [:bar] :current/:total :percent :etas', {total: jobs.length})
  const start = Date.now()
  const summaries = await Promise.all(
    jobs.map(async (job) => {
      const result = await pool(() => processOne(job))
      bar.tick()
      return result
    }),
  )
  const duration = Date.now() - start
  console.log(`Processed ${jobs.length} images in ${(duration / 1000).toFixed(1)}s`)

  console.log(summaries.map((s) => s.metadata))

  const targetNames = targets.map((t) => t.name)
  summaries.sort(
    (a, b) => a.inPath.localeCompare(b.inPath) || targetNames.indexOf(a.target) - targetNames.indexOf(b.target),
  )
  const cols = ['Output File', 'Size', 'Space Savings']
  const rows = summaries.map((s) => [s.outPath, s.outSize, `${((1 - s.ratio) * 100).toFixed(1)}%`])
  const opts = {drawHorizontalLine: (i: number) => i === 0 || (i - 1) % targets.length === 0}
  console.log(table([cols, ...rows], opts))
}

export async function processOne(job: Job) {
  const newPath = await mkdir(path.dirname(job.outPath), {recursive: true})
  if (newPath) console.log(`Created directory ${newPath}`)

  let resizeTo: string | undefined
  if (job.target.maxWidth && job.target.maxHeight) {
    resizeTo = `${job.target.maxWidth}x${job.target.maxHeight}>`
  } else if (job.target.maxWidth) {
    resizeTo = `${job.target.maxWidth}>`
  } else if (job.target.maxHeight) {
    resizeTo = `x${job.target.maxHeight}>`
  }

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

  let metadata: Metadata | undefined
  if (job.parseMetadata) {
    const raw =
      await $`exiftool -s -Make -Model -LensInfo -LensMake -LensModel -ExposureTime -FNumber -ISO -DateTimeOriginal -OffsetTimeOriginal ${job.inPath}`
    const parseResult = parseExiftoolMetadata(raw.stdout)
    if (!parseResult.success) {
      // TODO: Refactor this to return errors
      console.error(raw.stdout)
      console.error(raw.stderr)
      throw new Error(`${job.outPath}: ${parseResult.error}`)
    }

    metadata = parseResult.metadata
  }

  const inBytes = (await stat(job.inPath)).size
  const outBytes = (await stat(job.outPath)).size
  return {
    inPath: job.inPath,
    metadata,
    outPath: job.outPath,
    outSize: prettyBytes(outBytes),
    ratio: outBytes / inBytes,
    target: job.target.name,
  }
}
