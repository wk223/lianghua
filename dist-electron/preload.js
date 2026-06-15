import { contextBridge as n, ipcRenderer as t } from "electron";
n.exposeInMainWorld("electronAPI", {
  // ─── 通用 invoke ────────────────────────────
  invoke: (e, ...r) => [
    "PING",
    "ENV_CHECK",
    "ANALYZE_POOL",
    "ANALYZE_SINGLE",
    "GET_QUOTE",
    "GET_MARKET",
    "GET_SECTOR"
  ].includes(e) ? t.invoke(e, ...r) : Promise.reject(new Error(`不允许的 IPC 频道: ${e}`)),
  // ─── 流式事件 ───────────────────────────────
  onStreamEvent: (e) => {
    const r = (o, s) => {
      e(s);
    };
    return t.on("stream:event", r), () => {
      t.removeListener("stream:event", r);
    };
  },
  // ─── 启动流式分析 ─────────────────────────
  startStream: (e, r) => {
    t.send("stream:start", { type: e, payload: r });
  },
  // ─── 存储 ────────────────────────────────────
  store: {
    get: (e) => t.invoke("store:get", e),
    set: (e, r) => t.invoke("store:set", e, r),
    remove: (e) => t.invoke("store:remove", e),
    getWatchlist: () => t.invoke("store:getWatchlist"),
    setWatchlist: (e) => t.invoke("store:setWatchlist", e),
    getHistory: (e) => t.invoke("store:getHistory", e),
    addHistory: (e, r, o) => t.invoke("store:addHistory", e, r, o),
    removeHistory: (e) => t.invoke("store:removeHistory", e),
    clearHistory: () => t.invoke("store:clearHistory")
  }
});
