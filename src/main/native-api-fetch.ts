import {session} from 'electron';
import {secureHttpUrl} from '../shared/transport.ts';

/** Native API traffic has an in-memory session separate from every page/service.
 * Use Chromium's supported transport for cancellation in the Electron runtime. */
export const nativeApiFetch:typeof fetch=(input,init)=>{
 const request=input instanceof Request?input:null;
 const url=secureHttpUrl(request?.url??String(input));
 return session.fromPartition('annoy-native-api',{cache:false}).fetch(request??url.href,{
  ...init,cache:'no-store',credentials:'omit',redirect:'error',bypassCustomProtocolHandlers:true,
 });
};
