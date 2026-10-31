import { freezeInput, compile, packageResult } from './assembler.mjs';
export async function build(configuration, compileFiles = async files => files) {
  const plan = freezeInput(configuration);
  const compiled = await compile(plan, compileFiles);
  return packageResult(configuration, compiled);
}
