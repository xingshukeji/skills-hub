export async function reply(gateway, item, compose) {
  gateway.assertSource(item);
  const body = await compose(item);
  gateway.assertSource(item);
  return gateway.post(item.source, body);
}

export async function contactStarter(gateway, item, compose) {
  gateway.assertSource(item);
  const body = await compose(item);
  return gateway.post(item.starter, body);
}

export async function requestDetails(gateway, item, compose) {
  gateway.assertSource(item);
  const body = await compose(item);
  return gateway.post(item.source, body);
}

export async function reportToLead(gateway, item, compose) {
  gateway.assertSource(item);
  const body = await compose(item);
  return gateway.post(item.lead, body);
}

export function directMessage(gateway, destination, text) {
  return gateway.post(destination, text);
}
