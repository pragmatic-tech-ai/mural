import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Minimal bridge — the demo uses no native capability yet (storage stays the
// in-renderer DemoStorageStore). Room to add typed IPC here later.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define on window when context isolation is off)
  window.electron = electronAPI
}
