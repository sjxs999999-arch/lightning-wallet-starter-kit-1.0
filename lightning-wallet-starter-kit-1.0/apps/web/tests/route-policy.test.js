import {describe,expect,it} from 'vitest';
import {routeRequiresAuth} from '../public/api/v1/route-policy.js';

describe('serverless API route policy',()=>{
  it('keeps capabilities public while defaulting unknown routes to operator authentication',()=>{
    expect(routeRequiresAuth('GET','system/capabilities')).toBe(false);
    expect(routeRequiresAuth('GET','future-sensitive-route')).toBe(true);
    expect(routeRequiresAuth('POST','future-sensitive-route')).toBe(true);
  });
});
