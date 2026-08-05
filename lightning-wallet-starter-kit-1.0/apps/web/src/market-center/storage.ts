import type{MarketToken,PriceAlert,WatchItem}from'./types';
const WATCH='lightning-market-watchlist-v1',ALERTS='lightning-market-alerts-v1';
function read<T>(key:string):T[]{try{const value=JSON.parse(localStorage.getItem(key)??'[]');return Array.isArray(value)?value:[]}catch{return[]}}
function write<T>(key:string,value:T[]){localStorage.setItem(key,JSON.stringify(value))}
export const loadWatchlist=()=>read<WatchItem>(WATCH);
export function toggleWatch(token:MarketToken){const current=loadWatchlist(),exists=current.some(item=>item.chain===token.chain&&item.address===token.address),next=exists?current.filter(item=>item.chain!==token.chain||item.address!==token.address):[...current,{chain:token.chain,address:token.address,name:token.name,symbol:token.symbol}];write(WATCH,next);return next}
export const loadAlerts=()=>read<PriceAlert>(ALERTS);
export function addAlert(token:MarketToken,direction:'above'|'below',target:number){const next=[...loadAlerts(),{id:crypto.randomUUID(),chain:token.chain,address:token.address,symbol:token.symbol,direction,target,createdAt:new Date().toISOString()}];write(ALERTS,next);return next}
export function removeAlert(id:string){const next=loadAlerts().filter(item=>item.id!==id);write(ALERTS,next);return next}
export const triggered=(alert:PriceAlert,price:number|null)=>price!==null&&(alert.direction==='above'?price>=alert.target:price<=alert.target);
