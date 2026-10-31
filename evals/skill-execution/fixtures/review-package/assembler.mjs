import { createHash } from 'node:crypto';
export function freezeInput(configuration) { return structuredClone(configuration); }
export async function compile(plan, compileFiles) {
  const files = await compileFiles(structuredClone(plan.files));
  return { manifest: { name: plan.name, version: plan.version, dependencies: plan.dependencies }, files };
}
export function packageResult(configuration, compiled) {
  const content = JSON.stringify(compiled);
  return { filename: `${configuration.name}-${configuration.version}.appkg`, content, digest: createHash('sha256').update(content).digest('hex') };
}
