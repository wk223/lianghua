import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("electronAPI", {
  // ─── 通用 invoke ────────────────────────────
  invoke: (channel, ...args) => {
    const allowedChannels = [
      "PING",
      "ENV_CHECK",
      "ANALYZE_POOL",
      "ANALYZE_SINGLE",
      "GET_QUOTE",
      "GET_MARKET",
      "GET_SECTOR"
    ];
    if (allowedChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`不允许的 IPC 频道: ${channel}`));
  },
  // ─── 流式事件 ───────────────────────────────
  onStreamEvent: (callback) => {
    const handler = (_event, data) => {
      callback(data);
    };
    ipcRenderer.on("stream:event", handler);
    return () => {
      ipcRenderer.removeListener("stream:event", handler);
    };
  },
  // ─── 启动流式分析 ─────────────────────────
  startStream: (type, payload) => {
    ipcRenderer.send("stream:start", { type, payload });
  },
  // ─── 存储 ────────────────────────────────────
  store: {
    get: (key) => ipcRenderer.invoke("store:get", key),
    set: (key, value) => ipcRenderer.invoke("store:set", key, value),
    remove: (key) => ipcRenderer.invoke("store:remove", key),
    getWatchlist: () => ipcRenderer.invoke("store:getWatchlist"),
    setWatchlist: (list) => ipcRenderer.invoke("store:setWatchlist", list),
    getHistory: (options) => ipcRenderer.invoke("store:getHistory", options),
    addHistory: (record, note, tags) => ipcRenderer.invoke("store:addHistory", record, note, tags),
    removeHistory: (id) => ipcRenderer.invoke("store:removeHistory", id),
    clearHistory: () => ipcRenderer.invoke("store:clearHistory")
  }
});
