// Aplikasi desktop Windows: membungkus server lokal yang sama dalam satu jendela.
// Data (status, catatan, setelan, proposal) disimpan di folder data pengguna, bukan di folder program.
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Hanya link WhatsApp yang boleh dibuka di luar jendela ini (WhatsApp Desktop atau browser bawaan Windows).
const LINK_WHATSAPP = [/^whatsapp:\/\//i, /^https:\/\/web\.whatsapp\.com\//i];
const bolehDibuka = (url) => LINK_WHATSAPP.some((re) => re.test(url));

let jendela = null;

function cariPortBebas() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function tungguServer(port) {
  for (let i = 0; i < 50; i++) {
    const siap = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/state', timeout: 1000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (siap) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server lokal tidak merespons.');
}

async function mulaiServer() {
  const port = await cariPortBebas();
  const data = app.getPath('userData');
  process.env.PORT = String(port);
  process.env.DATA_DIR = path.join(data, 'data');
  process.env.PROPOSAL_DIR = path.join(data, 'proposal');
  await import(pathToFileURL(path.join(__dirname, '..', 'server.mjs')).href);
  await tungguServer(port);
  return port;
}

function buatJendela(port) {
  const asal = `http://127.0.0.1:${port}`;
  jendela = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Kirim Penawaran',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#11151b',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  const arahkan = (url) => {
    if (bolehDibuka(url)) shell.openExternal(url);
  };
  jendela.webContents.setWindowOpenHandler(({ url }) => {
    arahkan(url);
    return { action: 'deny' };
  });
  jendela.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(asal)) return;
    e.preventDefault();
    arahkan(url);
  });
  jendela.on('closed', () => { jendela = null; });
  jendela.loadURL(asal);
}

const satuInstans = app.requestSingleInstanceLock();
if (!satuInstans) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!jendela) return;
    if (jendela.isMinimized()) jendela.restore();
    jendela.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // Izin yang diminta halaman: hanya menyalin teks ke clipboard (tombol "Salin pesan").
    session.defaultSession.setPermissionRequestHandler((_wc, izin, selesai) => selesai(izin === 'clipboard-sanitized-write'));
    try {
      buatJendela(await mulaiServer());
    } catch (e) {
      const { dialog } = require('electron');
      dialog.showErrorBox('Kirim Penawaran gagal dimulai', String(e && e.message ? e.message : e));
      app.quit();
    }
  });

  app.on('window-all-closed', () => app.quit());
}
