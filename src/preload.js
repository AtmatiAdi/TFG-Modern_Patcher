'use strict';
// Most miedzy UI a procesem glownym. UI nie ma dostepu do node - tylko do tych metod.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('patcher', {
  info:       ()                  => ipcRenderer.invoke('app:info'),
  instances:  ()                  => ipcRenderer.invoke('instances:list'),
  refreshMods:()                  => ipcRenderer.invoke('catalog:refresh'),
  mods:       ()                  => ipcRenderer.invoke('catalog:list'),
  pickDir:    ()                  => ipcRenderer.invoke('instance:pick'),
  buildPlan:  (dir, options)      => ipcRenderer.invoke('plan:build', { dir, options }),
  apply:      (dir, options, ids) => ipcRenderer.invoke('plan:apply', { dir, options, ids }),
  revert:     (dir)               => ipcRenderer.invoke('plan:revert', { dir }),
  openPath:   (target)            => ipcRenderer.invoke('shell:open', target),
  window:     (action)            => ipcRenderer.invoke('window:action', action),
  onLog:      (cb)                => ipcRenderer.on('log', (e, msg) => cb(msg)),
});
