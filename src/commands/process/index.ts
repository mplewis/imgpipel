import {Args, Command, Flags} from '@oclif/core'
import {stripIndents} from 'common-tags'
import {z} from 'zod'

const targetSchema = z.object({
  maxHeight: z.coerce.number().int().optional(),
  maxWidth: z.coerce.number().int().optional(),
  name: z.string(),
  quality: z.coerce.number().optional(),
})
const targetRegex = /^(\w+):(\d+.\d+)?:(\d+)?:(\d+)?$/

type Target = z.infer<typeof targetSchema>

function parseTarget(raw: string): {error: string; success: false} | {success: true; target: Target} {
  const match = raw.match(targetRegex)
  if (!match) {
    return {
      error: `Invalid target \`${raw}\`: must match format \`name:quality:maxWidth:maxHeight\``,
      success: false,
    }
  }

  const [, name, quality, maxWidth, maxHeight] = match
  const values = {
    maxHeight: maxHeight || undefined,
    maxWidth: maxWidth || undefined,
    name,
    quality: quality || undefined,
  }
  const parsed = targetSchema.safeParse(values)
  if (!parsed.success) return {error: `Invalid target \`${raw}\`: ${parsed.error.message}`, success: false}
  return {success: true, target: parsed.data}
}

const args = {
  targets: Args.string({
    description: stripIndents`
				Image generation target specifications, in the format \`name:quality:maxWidth:maxHeight\`, e.g. \`large:1.0:1920:1080\`.
				Values other than \`name\` can be omitted, e.g. \`thumb::100:100\`, \`full:1.0::\`',
			`,
    required: true,
  }),
}

const description = 'Process images'

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
    const rawTargets = (argv as string[]).map((raw) => parseTarget(raw))
    const targets: Target[] = []
    const errors: string[] = []
    for (const [index, result] of rawTargets.entries()) {
      if (result.success) targets[index] = result.target
      else errors.push(result.error)
    }

    if (errors.length > 0) {
      this.error(errors.join('\n'))
    }

    for (const target of targets) if (!target.quality) target.quality = defaultQuality

    this.log(JSON.stringify({flags, targets}, null, 2))
  }
}
