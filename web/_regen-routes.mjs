import { Generator, getConfig } from '@tanstack/router-generator'

const config = await getConfig(
  { target: 'react', autoCodeSplitting: false },
  process.cwd()
)
await new Generator({ config, root: process.cwd() }).run()
console.log('routes regenerated')
