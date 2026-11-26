import { apiValue } from './http.mjs';
import { CliError, segment } from './core.mjs';

const hostTenants = '/api/service/authen/v1/host/tenants';

async function find(ctx, path, search, options, matches) {
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({ search, page, pageSize: 100 });
    const result = await apiValue(ctx, 'GET', path + '?' + query, undefined, options);
    if (!Array.isArray(result?.items) || !Number.isSafeInteger(result.totalCount))
      throw new CliError('The Host directory returned an invalid page.', { code: 'invalid_response' });
    const item = result.items.find(matches);
    if (item || page * 100 >= result.totalCount) return item;
  }
}

// The dedicated non-administrator membership records an undelivered request while Workforce is offline.
export async function recoverTenantCreation(ctx, profile, body, headers, mutation) {
  const options = { requireTenant: false, resolvedProfile: profile };
  const name = typeof body.name === 'string' && body.name.trim();
  if (!name) throw new CliError('Tenant name is required.', { code: 'invalid_arguments' });
  const prior = await find(ctx, hostTenants, name, options, item => item.name.toLowerCase() === name.toLowerCase());
  const detail = await apiValue(ctx, 'POST', hostTenants, body, { ...options, headers, mutation });
  const path = hostTenants + '/' + segment(detail.tenantId) + '/members';
  const marker = ctx.env.XRAIN_WORKFORCE_ENROLLMENT_USER_ID;
  let receipt;
  if (marker) {
    const read = () => find(ctx, path, marker, options, item => item.userId === marker);
    try {
      receipt = await read();
      if (!receipt && !prior) {
        try { receipt = await apiValue(ctx, 'POST', path, { userId: marker, isAdministrator: false }, { ...options, mutation }); }
        catch (error) {
          if (!(error instanceof CliError)) throw error;
          receipt = await read();
        }
      }
    } catch (error) {
      if (!(error instanceof CliError)) throw error;
      // The native tenant receipt remains valid even if the membership write could not be confirmed.
    }
  }
  // A prior tenant may have been disabled after a successful offline handoff.
  const recorded = !prior && receipt?.userId === marker && receipt?.isActive === true;
  return { ...detail, standardWorkforce: { tenantId: detail.tenantId, state: recorded ? 'pending' : 'unconfirmed',
    hint: recorded ? '租户已创建。租户管理员可从原门户继续开通 Workforce。' : '租户已创建。门户恢复后用 workforce show 查询，未受理时用 workforce set 开通。' } };
}
