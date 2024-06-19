import {Args, Command, Flags} from '@oclif/core'
import {stripIndents} from 'common-tags'

import {processMany} from '../../lib/process.js'
import {Target, parseTarget} from '../../types/target.js'

// TODO
const description = 'Process images'

const args = {
  targets: Args.string({
    description: stripIndents`
				Image generation target specifications, in the format \`name:quality:maxWidth:maxHeight\`, e.g. \`large:1.0:1920:1080\`.
				Values other than \`name\` can be omitted, e.g. \`thumb::100:100\`, \`full:1.0::\`',
			`,
    required: true,
  }),
}

const flags = {
  'chroma-subsampling': Flags.string({
    char: 'c',
    default: '420',
    description: 'Jpegli chroma subsampling',
    options: ['420', '422', '440', '444'],
  }),
  'in-dir': Flags.string({
    char: 'i',
    description: 'Input directory containing files',
    required: true,
  }),
  'out-dir': Flags.string({
    char: 'o',
    description: 'Output directory to write processed files',
    required: true,
  }),
  'out-metadata': Flags.string({
    char: 'm',
    description: 'Output file containing metadata for processed files',
  }),
  // TODO: Preserve dates only
  'preserve-metadata': Flags.boolean({
    description:
      'By default, metadata is stripped from output images to protect your privacy when publishing online. Use this flag to preserve metadata.',
  }),
  progressive: Flags.string({
    char: 'p',
    default: '2',
    description: 'Jpegli progressive level setting. 0 = sequential, higher value = more scans.',
    options: ['0', '1', '2'],
  }),
  quality: Flags.string({
    char: 'q',
    default: '1.0',
    description:
      'Jpegli max butteraugli distance. Lower value = higher quality, defaults to visually lossless. If a target does not provide quality, this is used as the default.',
  }),
}

// TODO
// const examples = [
//   stripIndents`
//     <%= config.bin %> <%= command.id %> friend --from oclif
//     hello friend from oclif! (./src/commands/hello/index.ts)
//   `,
// ]

export default class Process extends Command {
  static args = args
  static description = description
  // static examples = examples
  static flags = flags
  static strict = false

  async run(): Promise<void> {
    const {argv, flags} = await this.parse(Process)
    const defaultQuality = Number.parseFloat(flags.quality)
    const rawTargets = (argv as string[]).map((raw) => parseTarget(raw, defaultQuality))
    const targets: Target[] = []
    const errors: string[] = []
    for (const [index, result] of rawTargets.entries()) {
      if (result.success) targets[index] = result.target
      else errors.push(result.error)
    }

    if (errors.length > 0) {
      this.error(errors.join('\n'))
    }

    await processMany(
      {
        chromaSubsampling: flags['chroma-subsampling'],
        inDir: flags['in-dir'],
        outDir: flags['out-dir'],
        outMetadata: flags['out-metadata'],
        preserveMetadata: flags['preserve-metadata'],
        progressive: flags.progressive,
      },
      targets,
    )
  }
}
