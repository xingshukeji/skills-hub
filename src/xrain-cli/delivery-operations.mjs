import { booleanOutcome, nonempty } from './core.mjs';

const define = (path, method, route, options = {}) => ({ path, method, route, ...options });
const s3 = '/api/service/storage/v1/s3-accounts';
const email = '/api/delivery/v1/email';
const feishu = '/api/delivery/v1/feishu';
const personal = email + '/me';
const statusOutcome = (value, key, successes, failure) => successes.includes(value?.[key]) ? 'succeeded' : value?.[key] === failure ? 'failed' : value?.[key] === 'Unknown' ? 'unknown' : undefined;
const authentication = value => statusOutcome(value, 'status', ['Succeeded'], 'Failed');
const emailSend = value => nonempty(value?.messageId) ? statusOutcome(value, 'status', ['Queued', 'Sending', 'Accepted'], 'Failed') : undefined;
const providerSend = (value, id, status) => typeof value?.ignored !== 'boolean' ? undefined : value.ignored ? 'succeeded' :
  nonempty(value[id]) ? statusOutcome(value, status, ['Accepted'], 'Rejected') : undefined;
const mailboxCheck = value => {
  const states = [authentication(value?.receive), authentication(value?.send)];
  return states.some(state => state === undefined) ? undefined : states.includes('unknown') ? 'unknown' : states.includes('failed') ? 'failed' : 'succeeded';
};

export const deliveryOperations = [
  define('storage account list', 'GET', s3),
  define('storage account create', 'POST', s3, { input: 'object', secretInput: ['accessKeyId', 'secretAccessKey'] }),
  define('storage account rename', 'PUT', s3 + '/{id}/name', { input: 'object' }),
  define('storage account credentials', 'PUT', s3 + '/{id}/credentials', { input: 'object', secretInput: ['accessKeyId', 'secretAccessKey'] }),
  define('storage account check', 'POST', s3 + '/{id}/test'),
  define('storage account default', 'PUT', s3 + '/{id}/default'),
  define('email account list', 'GET', email + '/accounts'),
  define('email account set', 'PUT', email + '/accounts', { input: 'object', secretInput: ['password', 'smtpPassword'] }),
  define('email account check', 'POST', email + '/accounts/{id}/test', { outcome: authentication,
    description: "Send the native SMTP test email to this account's own address and report the result. Requires an authorized test." }),
  define('feishu account get', 'GET', feishu + '/account'),
  define('feishu account set', 'PUT', feishu + '/account', { input: 'object' }),
  define('feishu account check', 'POST', feishu + '/account/test', { outcome: value => booleanOutcome(value, 'succeeded') }),
  ...[['email', email], ['feishu', feishu]].flatMap(([name, base]) => [
    define(`${name} template list`, 'GET', base + '/templates'),
    define(`${name} template show`, 'GET', base + '/templates/{id}'),
    define(`${name} template create`, 'POST', base + '/templates', { input: 'object' }),
    define(`${name} template update`, 'PATCH', base + '/templates/{id}', { input: 'object' }),
    define(`${name} template preview`, 'POST', base + '/templates/{id}/' + (name === 'email' ? 'preview' : 'render-check'), { input: 'object', readOnly: true }),
    define(`${name} template send-test`, 'POST', base + '/templates/{id}/send-test', { input: 'object',
      outcome: name === 'email' ? emailSend : value => providerSend(value, 'messageId', 'status') }),
    define(`${name} message list`, 'GET', base + '/messages', { query: name === 'email' ? ['accountId', 'status', 'whatId', 'search', 'limit'] : ['templateId', 'status', 'receiveIdType', 'whatId', 'search', 'limit'] }),
    define(`${name} message show`, 'GET', base + '/messages/{id}'),
  ]),
  define('feishu user list', 'GET', feishu + '/users', { query: ['page', 'pageSize', 'search', 'isActive'] }),
  define('feishu user binding get', 'GET', feishu + '/users/{user-id}/binding'),
  define('feishu user binding set', 'PUT', feishu + '/users/{user-id}/binding', { input: 'object' }),
  define('sms account list', 'GET', '/api/sms/accounts', { host: true, query: ['tenantId'] }),
  define('sms account set', 'PUT', '/api/sms/accounts', { host: true, query: ['tenantId'], input: 'object' }),
  define('sms template list', 'GET', '/api/sms/templates', { host: true, query: ['tenantId', 'accountId'] }),
  define('sms template bind', 'POST', '/api/sms/templates', { host: true, query: ['tenantId'], input: 'object' }),
  define('sms send-test', 'POST', '/api/sms/test', { host: true, query: ['tenantId'], input: 'object', outcome: value => providerSend(value, 'recordId', 'submitStatus') }),
  define('sms records', 'GET', '/api/sms/records', { host: true, query: ['tenantId'] }),
  define('mail providers', 'GET', personal + '/providers'),
  define('mail account list', 'GET', personal + '/accounts'),
  define('mail account set', 'PUT', personal + '/accounts', { input: 'object', secretInput: ['password', 'imapPassword', 'smtpPassword'] }),
  define('mail account check', 'POST', personal + '/accounts/{id}/check', { outcome: mailboxCheck }),
  define('mail account delete', 'DELETE', personal + '/accounts/{id}'),
  define('mail account clear-credentials', 'DELETE', personal + '/accounts/{id}/credentials', { query: ['action'] }),
  define('mail folders', 'GET', personal + '/accounts/{id}/folders'),
  define('mail search', 'POST', personal + '/accounts/{id}/messages/search', { input: 'object', readOnly: true }),
  define('mail read', 'POST', personal + '/accounts/{id}/messages/read', { input: 'object', readOnly: true }),
  define('mail draft', 'POST', personal + '/accounts/{id}/drafts', { input: 'object' }),
];
for (const operation of deliveryOperations) {
  const root = operation.path.split(' ')[0];
  if (root === 'storage') operation.host = true;
  operation.readback = root === 'storage' ? ['storage', 'account', 'list'] : root === 'mail' ? ['mail', 'account', 'list'] :
    root === 'sms' ? ['sms', 'records'] : [root, 'message', 'list'];
}
