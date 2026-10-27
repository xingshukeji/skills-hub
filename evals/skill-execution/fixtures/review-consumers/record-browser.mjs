export class RecordBrowser {
  constructor(api, proxyIdentity, mainIdentity) {
    this.api = api; this.proxyIdentity = proxyIdentity; this.mainIdentity = mainIdentity;
  }
  async directory() {
    try { return await this.api.directory(this.proxyIdentity.token); }
    catch (error) {
      if (error.status !== 401) throw error;
      await this.proxyIdentity.renew();
      return this.api.directory(this.proxyIdentity.token);
    }
  }
  list(query) { return this.api.list(this.proxyIdentity.token, query); }
  detail(id) { return this.api.detail(this.proxyIdentity.token, id); }
}
