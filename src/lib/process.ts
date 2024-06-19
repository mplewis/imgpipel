import {glob} from 'glob'
import {mkdir, stat, writeFile} from 'node:fs/promises'
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

type ProcessJob = {
  chromaSubsampling: string
  inPath: string
  outPath: string
  parseMetadata: boolean
  preserveMetadata: boolean
  progressive: string
  target: Target
}

type ProcessResult = {
  inPath: string
  outPath: string
  outSize: string
  ratio: number
  target: string
}

export async function processMany(params: GlobalParams, targets: Target[]) {
  const pool = pLimit(os.cpus().length)
  const processJobs: ProcessJob[] = []
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

  // TODO: Don't regenerate existing files (with flag)
  // TODO: Delete mismatched files (with flag)

  const bar = new ProgressBar('Processing images [:bar] :current/:total :percent :etas', {total: processJobs.length})
  const start = Date.now()

  const processWip = processJobs.map(async (job) => {
    const result = await pool(() => processOne(job))
    bar.tick()
    return result
  })
  const processResults = await Promise.all(processWip)
  console.log(`Processed ${processJobs.length} images in ${((Date.now() - start) / 1000).toFixed(1)}s`)

  if (params.outMetadata) {
    const bar = new ProgressBar('Reading metadata [:bar] :current/:total :percent :etas', {total: inFiles.length})
    const metadataWip = inFiles.map(async (inPath) => {
      const metadata = readMetadata(inPath)
      bar.tick()
      return metadata
    })
    const results = await Promise.all(metadataWip)
    const metadatas: Record<string, Metadata> = {}
    for (const [i, inPath] of inFiles.entries()) {
      const result = results[i]
      if (result.success) metadatas[inPath] = result.metadata
    }

    console.log(`Processed metadata for ${inFiles.length} images in ${((Date.now() - start) / 1000).toFixed(1)}s`)

    saveMetadataReport(params, processResults, metadatas)
    console.log(`Saved metadata report to ${params.outMetadata}`)
  }

  const targetNames = targets.map((t) => t.name)
  processResults.sort(
    (a, b) => a.inPath.localeCompare(b.inPath) || targetNames.indexOf(a.target) - targetNames.indexOf(b.target),
  )
  const cols = ['Output File', 'Size', 'Space Savings']
  const rows = processResults.map((s) => [s.outPath, s.outSize, `${((1 - s.ratio) * 100).toFixed(1)}%`])
  const opts = {drawHorizontalLine: (i: number) => i === 0 || (i - 1) % targets.length === 0}
  console.log(table([cols, ...rows], opts))
}

export async function processOne(job: ProcessJob) {
  await mkdir(path.dirname(job.outPath), {recursive: true})

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

  const inBytes = (await stat(job.inPath)).size
  const outBytes = (await stat(job.outPath)).size
  return {
    inPath: job.inPath,
    outPath: job.outPath,
    outSize: prettyBytes(outBytes),
    ratio: outBytes / inBytes,
    target: job.target.name,
  }
}

async function saveMetadataReport(
  {inDir, outDir, outMetadata}: GlobalParams,
  processResults: ProcessResult[],
  metadatas: Record<string, Metadata>,
) {
  if (!outMetadata) throw new Error('No metadata destination path provided') // sanity check

  const metadatasRel: Record<string, Metadata> = {}
  for (const [origInPath, metadata] of Object.entries(metadatas)) {
    const inPath = path.relative(inDir, origInPath)
    metadatasRel[inPath] = metadata
  }

  const outPathToInPath: Record<string, string> = {}
  for (const result of processResults) {
    const outPath = path.relative(outDir, result.outPath)
    const inPath = path.relative(inDir, result.inPath)
    outPathToInPath[outPath] = inPath
  }

  const report = {metadata: metadatasRel, originals: outPathToInPath}
  await mkdir(path.dirname(outMetadata), {recursive: true})
  await writeFile(outMetadata, JSON.stringify(report, null, 2))
}
