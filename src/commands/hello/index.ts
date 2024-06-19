import {Args, Command, Flags} from '@oclif/core'
import {stripIndents} from 'common-tags'

const description = 'Say hello'

const args = {
	person: Args.string({description: 'Person to say hello to', required: true}),
}

const flags = {
	from: Flags.string({char: 'f', description: 'Who is saying hello', required: true}),
}

const examples = [
	stripIndents`
    <%= config.bin %> <%= command.id %> friend --from oclif
    hello friend from oclif! (./src/commands/hello/index.ts)
  `,
]

export default class Hello extends Command {
	static args = args
	static description = description
	static examples = examples
	static flags = flags

	async run(): Promise<void> {
		const {args, flags} = await this.parse(Hello)

		this.log(`hello ${args.person} from ${flags.from}! (./src/commands/hello/index.ts)`)
	}
}
