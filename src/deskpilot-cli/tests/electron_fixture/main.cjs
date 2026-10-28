// Isolated, offline WebContentsView fixture. Never attaches to a user's app/profile.
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [directory, title] = process.argv.slice(2);
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('force-renderer-accessibility');
app.whenReady().then(async () => {
  app.setAccessibilitySupportEnabled(true);
  const window = new BrowserWindow({ title, x: 400, y: 180, width: 980, height: 650,
    show: false, webPreferences: { sandbox: true } });
  window.setMenu(null);
  window.on('page-title-updated', event => event.preventDefault());
  const view = new WebContentsView({ webPreferences: {
    preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
  } });
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 980, height: 610 });
  ipcMain.on('fixture-state', (_event, state) => {
    fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
  });
  await view.webContents.loadFile(path.join(directory, 'index.html'));
  window.setTitle(title);
  window.show();
  window.focus();
  process.stdout.write(JSON.stringify({ ready: true, title, pid: process.pid,
    url: view.webContents.getURL(), electron: process.versions.electron }) + '\n');
  const cleanup = setInterval(() => {
    if (fs.existsSync(path.join(directory, 'close'))) {
      clearInterval(cleanup); view.webContents.close(); window.close(); app.quit();
    }
  }, 100);
});
app.on('window-all-closed', () => app.quit());
