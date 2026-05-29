const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getMyInstantsContext: () => ipcRenderer.invoke('get-myinstants-context'),
  getMyInstantsTrending: (payload) => ipcRenderer.invoke('get-myinstants-trending', payload),
  getMyInstantsCategory: (payload) => ipcRenderer.invoke('get-myinstants-category', payload),
  searchSounds: (searchTerm) => ipcRenderer.invoke('search-myinstants', searchTerm),
  downloadSound: (payload) => ipcRenderer.invoke('download-sound', payload),
  registerShortcut: (accelerator, soundId) =>
    ipcRenderer.send('register-shortcut', { accelerator, soundId }),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  toggleMaximizeWindow: () => ipcRenderer.send('window-toggle-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onShortcutTriggered: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('shortcut-triggered', listener);

    return () => {
      ipcRenderer.removeListener('shortcut-triggered', listener);
    };
  },
  onPlaySound: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('play-sound', listener);

    return () => {
      ipcRenderer.removeListener('play-sound', listener);
    };
  },
  onRegisterShortcutResponse: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('register-shortcut-response', listener);

    return () => {
      ipcRenderer.removeListener('register-shortcut-response', listener);
    };
  },
  onWindowMaximized: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('window-maximized', listener);

    return () => ipcRenderer.removeListener('window-maximized', listener);
  },
});