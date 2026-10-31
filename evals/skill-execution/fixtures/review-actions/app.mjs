import { reply, contactStarter, requestDetails, reportToLead, directMessage } from './actions.mjs';
export { Gateway } from './gateway.mjs';
export const operations = { reply, contact: contactStarter, supplement: requestDetails, escalate: reportToLead, direct: directMessage };
export const item = { id: 'item-1', source: 'source-a', starter: 'starter', lead: 'lead' };
