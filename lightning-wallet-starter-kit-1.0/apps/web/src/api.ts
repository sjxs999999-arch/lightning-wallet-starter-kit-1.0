const BASE=import.meta.env.VITE_API_URL || (import.meta.env.PROD?'/api/v1':'http://localhost:3001/api/v1');
const LEGACY_SESSION_KEY='lightning-session';
export const SESSION_EXPIRED_EVENT='lightning:session-expired';
const ERROR_CODE=/^[A-Z][A-Z0-9_]{0,63}$/;

export class ApiError extends Error {
  constructor(public readonly status:number,public readonly code:string){super(`API ${status} ${code}`);this.name='ApiError'}
}

export function secureRequestInit(init:RequestInit={}):RequestInit{const method=(init.method??'GET').toUpperCase(),headers=new Headers(init.headers);if(init.body!==undefined&&!headers.has('content-type'))headers.set('content-type','application/json');if(!['GET','HEAD','OPTIONS'].includes(method))headers.set('x-lightning-csrf','1');return{...init,credentials:'include',headers}}
export function takeLegacySessionToken():string{try{const token=localStorage.getItem(LEGACY_SESSION_KEY)??'';localStorage.removeItem(LEGACY_SESSION_KEY);return token}catch{return''}}
async function apiError(response:Response){let code=`HTTP_${response.status}`;try{const body=await response.json() as{error?:unknown};if(typeof body.error==='string'&&ERROR_CODE.test(body.error))code=body.error}catch{/* response body is intentionally ignored */}if(response.status===401&&typeof window!=='undefined')window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));return new ApiError(response.status,code)}
export async function api<T>(path:string,init?:RequestInit):Promise<T>{const res=await fetch(`${BASE}${path}`,secureRequestInit(init));if(!res.ok)throw await apiError(res);return res.json() as Promise<T>}
