import type{GasHistory}from'./types';const KEY='lightning-gasfree-history-v1',MAX=100;
export function loadGasHistory(storage:Pick<Storage,'getItem'>=localStorage):GasHistory[]{try{const value=JSON.parse(storage.getItem(KEY)||'[]');return Array.isArray(value)?value.slice(0,MAX):[]}catch{return[]}}
export function saveGasHistory(item:GasHistory,storage:Pick<Storage,'getItem'|'setItem'>=localStorage){const next=[item,...loadGasHistory(storage)].slice(0,MAX);storage.setItem(KEY,JSON.stringify(next));return next}
