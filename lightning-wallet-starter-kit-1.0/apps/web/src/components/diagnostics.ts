export const CLIENT_RELEASE='2.25.0';

export type ClientCrashReport={name:string;code:'RENDER_FAILURE';route:string;fingerprint:string;release:string};

const hex=(bytes:Uint8Array)=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');

export async function buildClientCrashReport(error:Error,componentStack:string,pathname:string):Promise<ClientCrashReport>{
  const name=error.name.replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100)||'Error';
  const route=pathname.split(/[?#]/,1)[0]!.replace(/[^A-Za-z0-9/_-]/g,'').slice(0,200)||'/';
  const source=new TextEncoder().encode(`${name}\n${error.stack??''}\n${componentStack}`);
  try{
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',source));
    return{name,code:'RENDER_FAILURE',route,fingerprint:hex(digest.slice(0,12)),release:CLIENT_RELEASE};
  }finally{source.fill(0)}
}
