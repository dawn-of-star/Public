/**
 * save.js —— 存档（localStorage）
 *
 * 只负责「读 / 写 / 删」，字段的校验和补全在 state.js 的 deserialize 里。
 */

import { BASE } from "./config.js";
import { deserialize, newState, serialize } from "./state.js";

export function save(state) {
  try {
    state.lastSavedAt = Date.now();
    const json = JSON.stringify(serialize(state));
    localStorage.setItem(BASE.saveKey, json);
    return json.length;
  } catch (err) {
    console.warn("存档失败：", err);
    return 0;
  }
}

/** @returns {{state: object, offlineSeconds: number, ok: boolean}|null} */
export function load() {
  let raw;
  try {
    raw = localStorage.getItem(BASE.saveKey);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn("存档 JSON 损坏，已忽略：", err);
    return null;
  }

  const { state, ok } = deserialize(parsed);
  const savedAt = Number(parsed?.lastSavedAt) || Date.now();
  const offlineSeconds = Math.max(0, (Date.now() - savedAt) / 1000);
  return { state, offlineSeconds, ok };
}

export function clear() {
  try {
    localStorage.removeItem(BASE.saveKey);
  } catch { /* ignore */ }
}
