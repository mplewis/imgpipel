import {glob} from 'glob'
import {mkdir, stat} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pLimit from 'p-limit'
import prettyBytes from 'pretty-bytes'
import * as tmp from 'tmp-promise'
import {$} from 'zx'

import {Target} from '../types/target.js'

const imgExtensions = ['jpg', 'jpeg', 'png']

// $.verbose = true
$.quiet = true

type GlobalParams = {
  chromaSubsampling: string
  inDir: string
  outDir: string
  preserveMetadata: boolean
  progressive: string
}

type Job = {
  chromaSubsampling: string
  inPath: string
  outPath: string
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
        preserveMetadata: params.preserveMetadata,
        progressive: params.progressive,
        target,
      }
      jobs.push(job)
    }
  }

  // TODO: Don't regenerate existing files (with flag)
  // TODO: Delete mismatched files (with flag)

  // TODO: Progress bar
  return Promise.all(jobs.map((job) => pool(() => processOne(job))))
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

  const inBytes = (await stat(job.inPath)).size
  const outBytes = (await stat(job.outPath)).size
  const ratio = outBytes / inBytes
  console.log(`${job.outPath}: ${prettyBytes(outBytes)} (${(ratio * 100).toFixed(1)}% of original)`)
}
