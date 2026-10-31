import { CliError, equalIgnoreCase, nonempty, origin } from './core.mjs';

export function identifier(value, label) {
  if (!nonempty(value) || !/^[a-zA-Z0-9._-]{1,160}$/.test(value) || value === '.' || value === '..')
    throw new CliError(`${label} must be a valid exact identifier.`, { code: 'invalid_arguments' });
  return value;
}

export function samePlatformTarget(saved, server, tenant, scope = 'tenant') {
  if (!nonempty(saved?.server)) return false;
  try { return origin(saved.server) === origin(server) && equalIgnoreCase(saved.tenant, tenant) && (saved.scope ?? 'tenant') === scope; }
  catch { return false; }
}

export function runtimeOrigin(profile) {
  if (profile.invalidRuntime) throw new CliError('The saved agent Runtime address is invalid.', {
    code: 'invalid_runtime_configuration', hint: 'Correct the address with profile set --runtime, or supply --runtime for this command.',
    details: { profile: profile.name, server: profile.server, tenant: profile.tenant ?? null },
  });
  if (!nonempty(profile.runtime)) throw new CliError('The agent Runtime is not configured for this platform and tenant.', {
    code: 'runtime_not_configured',
    hint: 'Save the service-provided address with profile set --runtime, or supply --runtime for this command.',
    details: { profile: profile.name, server: profile.server, tenant: profile.tenant ?? null },
  });
  return origin(profile.runtime);
}

export function applicationId(profile) {
  if (profile.invalidApplicationId) throw new CliError('The saved agent application ID is invalid.', {
    code: 'invalid_application_configuration', hint: 'Correct it with profile set --application-id, or use --personal.',
  });
  return profile.applicationId === undefined || profile.applicationId === null ? undefined : identifier(profile.applicationId, 'Application ID');
}
