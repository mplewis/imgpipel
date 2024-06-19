import {glob} from 'glob'
import os from 'node:os'
import path from 'node:path'
import pLimit from 'p-limit'
import {$} from 'zx'

import {Target} from '../types/target.js'

const imgExtensions = ['jpg', 'jpeg', 'png']

type GlobalParams = {
  chromaSubsampling: string
  inDir: string
  outDir: string
}

type Job = {
  chromaSubsampling: string
  inPath: string
  outPath: string
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
      const outPath = path.join(params.outDir, path.relative(params.inDir, inPath))
      const job: Job = {chromaSubsampling: params.chromaSubsampling, inPath, outPath, target}
      jobs.push(job)
    }
  }

  // TODO: Progress bar
  return Promise.all(jobs.map((job) => pool(() => processOne(job))))
}

export async function processOne(job: Job) {
  // TODO: Implement
  console.log({job})
}
